#!/usr/bin/env python3
"""Scope denetimi: her API ucu icin Jev (typesafe/jev-1.13) hangi scope/aktor gerekir diyor,
kod gercekte neyi kontrol ediyor? Yalniz stdlib. (TASK-354)

  python3 backend/tools/scope_audit.py --dry-run          # API yok: rotalar + kod kontrolleri
  python3 backend/tools/scope_audit.py --limit 2          # ilk 2 uc
  python3 backend/tools/scope_audit.py --only /records    # yol parcasina gore
  python3 backend/tools/scope_audit.py                    # hepsi (onceki cevaplar yeniden kullanilir; --force ile yenile)

Cikti: backend/tools/scope_audit.json + scope_audit.md
"""
import argparse, json, os, re, sys, urllib.error, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "backend/src/api"
OUT_JSON = ROOT / "backend/tools/scope_audit.json"
OUT_MD = ROOT / "backend/tools/scope_audit.md"
MODEL = "typesafe/jev-1.13"
URL = "https://openrouter.ai/api/alpha/decisions"
MAX_CALLS = 200
CODE_CHARS = 6000
HELPER_CHARS = 1200
HI, LO = 0.7, 0.3

APP = ("Team task tracker (EkipTakip): records (cards with actions, chats, attachments), a nodes tree "
       "(units, event types, locations), teams and pillars, events with checkpoints/widgets/materials/purchases. "
       "Admins bypass every check. Scopes grant capabilities. Branch editors may edit nodes under a branch "
       "they were granted. Record owners, creators, participants and team members may edit their record.")

ACTORS = {
    "anyone_logged_in": "any signed-in user, no further check",
    "record_member": "a member of the record/event/team/chat concerned (participant, team member)",
    "owner_or_editor": "the owner or creator of the thing, or someone allowed to edit it",
    "branch_editor": "a user with edit permission on the node branch concerned",
    "scope_holder": "a user holding a specific capability scope",
    "admin_only": "administrators only",
}


# ---------------------------------------------------------------- yardimcilar
def key():
    if k := os.environ.get("OPENROUTER_API_KEY"):
        return k
    for line in (Path.home() / ".env").read_text().splitlines():
        if "OPENROUTER_API_KEY=" in line:
            return line.split("=", 1)[1].strip().strip("'\"")
    sys.exit("OPENROUTER_API_KEY yok (env ya da ~/.env)")


def mask(src):
    """Yorum ve metin icerigini ayni uzunlukta bosluga cevir (parantez/suslu sayimi icin)."""
    blank = lambda m: re.sub(r"[^\n]", " ", m.group(0))
    src = re.sub(r'(?<!\w)r(#*)".*?"\1', blank, src, flags=re.S)
    src = re.sub(r'"(?:\\.|[^"\\])*"', blank, src)
    return re.sub(r"//[^\n]*", blank, src)


def balanced(masked, i, open_c, close_c):
    """masked[i] == open_c; eslesen kapanisin sonrasindaki indeksi don."""
    depth = 0
    for j in range(i, len(masked)):
        depth += masked[j] == open_c
        depth -= masked[j] == close_c
        if depth == 0:
            return j + 1
    return len(masked)


# ---------------------------------------------------------------- kaynak dizini
FN_RE = re.compile(r"(?:pub(?:\([a-z]+\))?\s+)?(?:async\s+)?fn\s+(\w+)")
FNS = {}  # (modul, fn) -> govde metni (imzadan sona)


def index_fns():
    for f in sorted(API.glob("*.rs")):
        src = f.read_text()
        m = mask(src)
        USES[f.stem] = " ".join(re.findall(r"\buse\s[^;]*;", m))
        for fm in FN_RE.finditer(m):
            b = m.find("{", fm.end())
            if b < 0:
                continue
            FNS.setdefault((f.stem, fm.group(1)), src[fm.start():balanced(m, b, "{", "}")])


USES = {}  # modul -> `use ...;` metinleri birlesik


def callee(mod, q, fn):
    """Cagrilan yardimcinin (modul, fn) anahtari: `modul::fn`, yerel, ya da `use` ile iceri alinmis."""
    if q in {k[0] for k in FNS}:
        return (q, fn)
    if q is None:
        if (mod, fn) in FNS:
            return (mod, fn)
        if re.search(rf"\b{fn}\b", USES.get(mod, "")):
            return next(((m, fn) for m, f in FNS if f == fn and m != mod), None)


def handler_text(mod, name, depth=2):
    """Isleyici govdesi + cagirdigi yardimcilar (ponytail: `depth` seviye, iki)."""
    helpers = {}

    def walk(key, d):
        for cm in re.finditer(r"\b(?:(\w+)::)?(\w+)\s*\(", mask(FNS[key])):
            t = callee(key[0], *cm.groups())
            if t in FNS and t != (mod, name) and t not in helpers:
                helpers[t] = FNS[t][:HELPER_CHARS]
                if d > 1:
                    walk(t, d - 1)

    if (mod, name) not in FNS:
        return None, []
    walk((mod, name), depth)
    text = FNS[(mod, name)]
    for (t, fn), h in helpers.items():
        text += f"\n\n// --- helper {t}::{fn}\n{h}"
    return text, [f"{t}::{fn}" for t, fn in helpers]


# ---------------------------------------------------------------- rotalar
def parse_routes():
    src = (API / "mod.rs").read_text()
    m = mask(src)
    routes = []
    for rm in re.finditer(r"\.route\(", m):
        end = balanced(m, rm.end() - 1, "(", ")")
        call = src[rm.end():end - 1]
        path = re.match(r'\s*"([^"]+)"', call).group(1)
        for vm in re.finditer(r"\b(get|post|put|patch|delete)\(\s*([\w:]+)", mask(call)):
            verb, h = vm.groups()
            mod, name = h.split("::") if "::" in h else ("mod", h)
            routes.append({"method": verb.upper(), "path": path, "handler": f"{mod}::{name}"})
    return routes


# ---------------------------------------------------------------- scope listesi
def load_scopes():
    """Anahtarlar migrations'tan, Turkce aciklamalar frontend/src/lib/labels.ts'ten (migrations'ta aciklama yok)."""
    names = []
    for f in sorted((ROOT / "backend/migrations").glob("*.sql")):
        for blk in re.findall(r"insert into scopes \(name\) values(.*?)(?:on conflict|;)", f.read_text(), re.S):
            names += re.findall(r"\('(\w+)'\)", blk)
    labels = (ROOT / "frontend/src/lib/labels.ts").read_text()
    return {n: (re.search(rf"\b{n}:\s*\"([^\"]+)\"", labels) or [None, n])[1] for n in names}


# ---------------------------------------------------------------- gercek kontroller
MARKERS = [  # (etiket, regex, aktor)
    ("is_admin", r"\bis_admin\b", None),
    ("require_admin", r"\b(admin_only|require_admin)\b|if\s*!\s*\w+\.is_admin\s*\{", "admin_only"),
    ("can_manage", r"\bcan_manage\b", None),
    ("can_edit", r"\b(can_edit_record|require_edit|editable|can_edit)\b", "owner_or_editor"),
    ("branch/NodeAccess", r"\b(NodeAccess|authorized_on_node|permitted_nodes|refdata::editor)\b|\bbranch\b", "branch_editor"),
    ("owner_id", r"\b(owner_id|created_by|uploader_id)\b", "owner_or_editor"),
    ("membership", r"\b(is_member|team_members|record_participants|require_member|chat_member|can_read)\b", "record_member"),
    ("approver", r"\b(is_approver|require_approver)\b", None),
]


def actual_checks(text, scopes, method):
    code = mask_keep_strings(text)
    found = [s for s in scopes if re.search(rf'"{s}"', code)]
    marks = [lab for lab, rx, _ in MARKERS if re.search(rx, code)]
    if method != "GET" and re.search(r"\bNodeAccess\b", code):
        # NodeAccess scope'lari db/scope.rs + refdata'da: edit_nodes (+dal), hard_delete_nodes, scope'lu koklerde tur/yer scope'u
        found += [s for s in ("edit_nodes", "hard_delete_nodes", "manage_event_types", "manage_event_locations")
                  if s in scopes and s not in found]
    actors = {a for lab, rx, a in MARKERS if a and re.search(rx, code)}
    if found:
        actors.add("scope_holder")
    if not found and not marks:
        marks.append("session_only" if "CurrentUser" in text else "no_session")
        actors.add("anyone_logged_in")
    return {"scopes": found, "markers": marks, "actors": sorted(actors) or ["unclear"]}


def mask_keep_strings(text):
    return re.sub(r"//[^\n]*", "", text)


# ---------------------------------------------------------------- Jev
spent = calls = 0.0


def ask(state, questions):
    global spent, calls
    calls += 1
    req = urllib.request.Request(URL, json.dumps({"model": MODEL, "state": state, "questions": questions}).encode(),
                                 {"Authorization": f"Bearer {key()}", "Content-Type": "application/json"})
    try:
        r = json.load(urllib.request.urlopen(req, timeout=60))
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.read().decode()[:200]}"
    except Exception as e:  # ag hatasi
        return None, str(e)[:200]
    spent += r.get("usage", {}).get("cost", 0)
    return r["answers"], None


def jev_endpoint(r, text, scopes):
    state = {"app": APP, "endpoint": f"{r['method']} {r['path']}", "handler_code": text[:CODE_CHARS], "scopes": scopes}
    qs = {f"scope_{k}": {"type": "noul", "instructions":
          f"Should calling this endpoint require scope {k} ({v.split(' — ')[0]})? Judge what the endpoint SHOULD require, not only what the code does."}
          for k, v in scopes.items()}
    qs["actor"] = {"type": "choice", "criteria": ACTORS,
                   "instructions": "Who should be allowed to call this endpoint? Pick the single most fitting actor class."}
    ans, err = ask(state, qs)
    if err:
        return {"error": err}
    return {"scopes": {k: ans[f"scope_{k}"]["noul"] for k in scopes},
            "actor": ans["actor"]["choice"], "actor_probs": ans["actor"]["probabilities"],
            "confidence": ans["actor"].get("confidence")}


# ---------------------------------------------------------------- rapor
def table(results):
    rows = ["| endpoint | code checks | jev scopes (p>0.7) | jev actor | flag |", "|---|---|---|---|---|"]
    for e in results.values():
        j = e.get("jev")
        if not j or "error" in j:
            continue
        a = e["actual_checks"]
        hi = [k for k, p in j["scopes"].items() if p > HI]
        flags = [f"jev wants {k}" for k in hi if k not in a["scopes"]]
        flags += [f"code has {k}, jev p={j['scopes'][k]:.2f}" for k in a["scopes"] if j["scopes"].get(k, 1) < LO]
        if j["actor"] not in a["actors"] and a["actors"] != ["unclear"]:
            flags.append(f"actor: code {'/'.join(a['actors'])} vs jev {j['actor']}")
        e["flags"] = flags
        if flags:
            code = ", ".join(a["scopes"] + a["markers"])
            rows.append(f"| `{e['method']} {e['path']}` | {code} | {', '.join(hi) or '-'} | {j['actor']} ({j['actor_probs'][j['actor']]:.2f}) | {'; '.join(flags)} |")
    return "\n".join(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--only")
    ap.add_argument("--force", action="store_true", help="onceki Jev cevaplarini yeniden sor")
    a = ap.parse_args()

    index_fns()
    scopes = load_scopes()
    routes = parse_routes()
    results = json.loads(OUT_JSON.read_text()) if OUT_JSON.exists() and not a.dry_run else {}

    for r in routes:
        k = f"{r['method']} {r['path']}"
        text, helpers = handler_text(*r["handler"].split("::"))
        if text is None:
            print(f"UYARI: isleyici govdesi bulunamadi: {r['handler']}", file=sys.stderr)
            text, helpers = "", []
        e = results.setdefault(k, {})
        e.update(method=r["method"], path=r["path"], handler=r["handler"], helpers=helpers,
                 actual_checks=actual_checks(text, scopes, r["method"]))
        e["_text"] = text

    todo = [k for k, e in results.items() if (not a.only or a.only in e["path"])]
    if a.dry_run:
        print(f"{len(routes)} rota, {len(scopes)} scope: {', '.join(scopes)}")
        for k in todo:
            c = results[k]["actual_checks"]
            print(f"{k:55} {results[k]['handler']:28} scopes={c['scopes']} marks={c['markers']} actors={c['actors']}")
        return

    done = 0
    bad = 0
    for k in todo:
        e = results[k]
        if "jev" in e and "error" not in e["jev"] and not a.force:
            continue
        if (a.limit and done >= a.limit) or calls >= MAX_CALLS or bad >= 3:
            break
        e["jev"] = jev_endpoint(e, e["_text"], scopes)
        bad = bad + 1 if "error" in e["jev"] else 0
        done += 1
        print(f"[{done}] {k} -> {e['jev'].get('actor', e['jev'].get('error'))}", file=sys.stderr)

    for e in results.values():
        e.pop("_text", None)
    md = table(results)
    OUT_JSON.write_text(json.dumps(results, indent=1, ensure_ascii=False) + "\n")
    OUT_MD.write_text(md + "\n")
    print(md)
    print(f"\ncagri: {int(calls)}  harcama: ${spent:.6f}", file=sys.stderr)


if __name__ == "__main__":
    main()
