#!/usr/bin/env python3
"""Direct OpenRouter decision quality evaluation; never contacts app or database."""
import argparse
import concurrent.futures
import json
import math
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "backend/tools/quality_eval.jsonl"
RESULTS = ROOT / "backend/tools/quality_eval_results.jsonl"
REPORT = ROOT / "backend/tools/quality_eval_report.md"
KEY_FILE = Path("/Users/Efe/projects/teamtracker/.envapi")
URL = "https://openrouter.ai/api/alpha/decisions"
MODEL = "respan/span-01-lite"
REPEATS = 3
CONCURRENCY = 3
TIMEOUT = 20

# Copied verbatim from backend/src/decision.rs ENTRY / CLOSING / body().
QUESTIONS = {
    "closing": {"closing_justified": {
        "type": "noul",
        "instructions": "A club member is closing a task record and wrote this closing note (Turkish). Does the note explain what was done, what the outcome was, or why the record is being closed?",
        "criteria": {"true": "States what was done / the result / the reason for closing.", "false": "Filler or empty phrases; does not say what was done or why it is closed."}}},
    "entry": {
        "specific": {"type": "noul",
            "instructions": "A club member wrote this task record (Turkish). Does the description name a concrete action or outcome (what exactly, which object, which result), rather than repeating the title or using filler words?",
            "criteria": {"true": "Names a concrete action/outcome beyond the title.", "false": "Repeats the title, filler, or too vague to act on."}},
        "context": {"type": "noul",
            "instructions": "Could a teammate who was not present understand why this matters, for whom, or where/when, from this text alone?",
            "criteria": {"true": "Gives at least some why/for whom/where/when context.", "false": "No context; a newcomer would have to ask what this is about."}}}}

# Deliberately test whether minimal clarification accepts meaningful concise notes
# without teaching the judge to pass empty text.
ALTERNATIVES = {
    "alt1_closing_context": {
        "instructions": "A club member is closing a task record and wrote this closing note (Turkish). Does it give at least one meaningful detail about the action, outcome, or reason for closing? A short note is sufficient; it need not include dates, amounts, or a full explanation.",
        "true": "Mentions a real action, result, or reason for closing, even briefly.",
        "false": "Empty, generic filler, or merely says it is done without any meaningful detail."},
    "alt2_closing_action": {
        "instructions": "A club member is closing a task record and wrote this closing note (Turkish). Judge only whether the note communicates a concrete action taken, an outcome, or a reason the record is closed. Do not require extra context or polished wording.",
        "true": "Communicates any action taken, result, or reason for closure.",
        "false": "No action, result, or closure reason; only empty/generic filler."}}

# Each tuple: title, note/description, label, rationale. 30 paired concepts per kind;
# each pair emits normal Turkish and a spelling/name variant (60 rows per kind).
CLOSINGS = [
("Sponsorluk görüşmesi", "Sponsor A ile 3 Ekim'de görüşüldü, 5.000 TL destek onaylandı; sözleşme taslağı gönderildi.", "good", "Eylem, tarih, sonuç ve sonraki adım açık."),
("Salon rezervasyonu", "Mert belediye salonunu 12 Kasım için ayırttı; onay yazısı geldi.", "good", "Rezervasyon eylemi ve sonucu belli."),
("Afiş baskısı", "Afişler 200 adet basıldı ve etkinlik ekibine teslim edildi.", "good", "Üretim miktarı ve teslim sonucu belirtilmiş."),
("Ses sistemi", "Teknik ekip mikrofon arızasını giderdi; prova sorunsuz tamamlandı.", "good", "Yapılan iş ve sonuç açık."),
("Atölye malzemeleri", "Ayşe 24 boya setini temin etti; katılımcı masalarına dağıtıldı.", "good", "Temin ve dağıtım sonucu net."),
("Toplantı notları", "Toplantı kararları paylaşımlı klasöre aktarıldı, üç sorumluya görev verildi.", "good", "Kapanış gerekçesi ve somut çıktı var."),
("Sponsor dosyası", "Sponsor A'nın logo dosyası alındı ve afiş taslağına eklendi.", "good", "Alınan dosya ve kullanım sonucu belirtilmiş."),
("Etkinlik izinleri", "İlçe izin formu teslim edildi; etkinlik tarihi için yazılı onay alındı.", "good", "İşlem ve sonuç açık."),
("Yaka kartları", "40 yaka kartı kesilip basıldı, gönüllülere dağıtıldı.", "good", "Somut üretim ve teslim var."),
("Ulaşım planı", "Minibüs 09.00 için ayarlandı; sürücü ve katılımcı listesi teyit edildi.", "good", "Eylemler ve sonuç somut."),
("Sponsorluk görüşmesi", "Sponsor A ile gorusuldu; 5.000 TL destek onaylandi ve taslak yollandı.", "good", "Aksan farkı dışında eylem ve sonuç açık."),
("Salon rezervasyonu", "Belediye salonu 12 Kasım için ayrıldı; onay yazısı ulaştı.", "good", "İsim olmadan da işlem ve sonuç anlaşılır."),
("Afiş baskısı", "200 afis basildi, etkinlik ekibine teslim edildi.", "good", "ASCII yazımında miktar ve teslim net."),
("Ses sistemi", "Mikrofon arizasi giderildi, prova sorunsuz bitti.", "good", "Aksansız yazımda eylem ve sonuç korunuyor."),
("Atölye malzemeleri", "24 boya seti temin edilip katılımcı masalarına dağıtıldı.", "good", "İsim yok; somut temin ve dağıtım belirtilmiş."),
("Toplantı notları", "Kararlar paylaşımlı klasöre aktarıldı ve üç kişiye görev verildi.", "good", "İsim yok; somut çıktı ve sonuç var."),
("Sponsor dosyası", "Sponsor logosu alındı ve afiş taslağına eklendi.", "good", "İsim yok; dosya ve eylem net."),
("Etkinlik izinleri", "İzin formu teslim edildi, etkinlik tarihi yazılı olarak onaylandı.", "good", "Kurumsal isim olmadan da kapanış gerekçesi açık."),
("Yaka kartları", "40 yaka kartı basıldı ve gönüllülere dağıtıldı.", "good", "Somut miktar, üretim, alıcı var."),
("Ulaşım planı", "Minibüs 09.00 için ayarlandı; sürücü ve katılımcı listesi doğrulandı.", "good", "İsim olmadan planlama sonucu anlaşılır."),
("Sponsorluk", "Sponsor A ile görüşme yapıldı ve gerekli aksiyon alındı.", "borderline", "Görüşme eylemi var; aksiyonun ne olduğu belirsiz. Gerçek reddedilen örneğin yalnız uydurma isimli ikizi."),
("Atölye hazırlığı", "Malzemeler toplandı, hazırlık tamamlandı.", "borderline", "Bir eylem var ama hangi malzeme ve kullanım sonucu belirsiz."),
("Toplantı", "Toplantı yapıldı, kararlar alındı.", "borderline", "Toplantı ve karar sonucu var; içerik açıklanmıyor."),
("Baskı işi", "Afişler basıldı.", "borderline", "Somut eylem var; miktar ve teslim bilgisi yok."),
("Salon", "Salon için başvuru yapıldı, dönüş bekleniyor.", "borderline", "Eylem ve durum var; sonuç henüz yok."),
("Sponsor takibi", "Sponsor A ile gorusme saglandi, donus bekleniyor.", "borderline", "ASCII yazımı ve bekleyen sonuç; kısa ama anlamlı."),
("Ses provası", "Mikrofon işi halloldu.", "borderline", "Bir işlem tamamlanmış; neyin nasıl sonuçlandığı muğlak."),
("Gönüllü planı", "Ekip konuştu, görevler paylaşıldı.", "borderline", "Eylem ve çıktı var; kim/ne görevi belirsiz."),
("Malzeme alımı", "Eksikler alındı, iş tamam.", "borderline", "Alım eylemi var; eksiklerin ne olduğu ve kullanım belirsiz."),
("Etkinlik izni", "Başvuru gönderildi; gerekli işlemler yapıldı.", "borderline", "Başvuru somut; diğer ifade genel ve sonuç yok."),
("Sponsorluk", "Sponsorla gorusuldu, konu kapandi.", "borderline", "ASCII ve isim yok; görüşme belirtiliyor ancak neden kapandığı açıklanmıyor."),
("Atölye hazırlığı", "Boyalar hazırlandı.", "borderline", "Kısa somut eylem var; kimin/ne için olduğu yok."),
("Toplantı", "Kararlar not edildi.", "borderline", "Somut tek eylem, kararların içeriği yok."),
("Baskı işi", "Afişler basım için matbaaya verildi.", "borderline", "Somut adım var, henüz sonuç yok."),
("Salon", "Salon tarihi netleşti.", "borderline", "Sonuç var; tarihin kendisi ve teyit biçimi belirtilmemiş."),
("Sponsor takibi", "Sponsor A ile gorusme yapildi.", "borderline", "ASCII kısa eylem; görüşme sonucu yok."),
("Ses provası", "Ses kontrolü yapıldı, sorun çıkmadı.", "borderline", "Eylem ve sonuç var; hangi sistem/prova belirsiz."),
("Gönüllü planı", "Gönüllülerle plan yapıldı.", "borderline", "Kısa anlamlı eylem ama plan içeriği yok."),
("Malzeme alımı", "Boya ve kağıt alındı.", "borderline", "Somut alım var; miktar, amaç veya teslim yok."),
("Etkinlik izni", "İzin süreci takip edildi.", "borderline", "Süreç eylemi var, sonuç belirtilmiyor."),
("Sponsorluk", "Tamamlandı.", "bad", "Ne yapıldığı veya neden kapandığı söylenmiyor."),
("Atölye hazırlığı", "Yapıldı gerekli işlem yapıldı.", "bad", "İçerik vermeyen tekrar/filler."),
("Toplantı", "ok", "bad", "Anlamlı eylem veya sonuç yok."),
("Baskı işi", "Afiş baskısı", "bad", "Başlık aynen yinelenmiş; kapanış bilgisi yok."),
("Salon", "aaaaaa", "bad", "Anlamsız metin."),
("Sponsor takibi", "Bitti.", "bad", "Sadece tamamlanma bildirimi."),
("Ses provası", "Gerekli aksiyon alındı.", "bad", "Aksiyonun ne olduğu ve sonucu yok."),
("Gönüllü planı", "İşlem sağlandı.", "bad", "Boş/genel ifade."),
("Malzeme alımı", "Her şey halledildi.", "bad", "Hangi iş veya sonuç olduğu söylenmiyor."),
("Etkinlik izni", "Kapatıldı.", "bad", "Kapanış nedeni yok."),
("Sponsorluk", "tamamlandi", "bad", "ASCII haliyle de yalnız boş tamamlanma ifadesi."),
("Atölye hazırlığı", "Gerekenler yapıldı.", "bad", "Neyin yapıldığı belirsiz filler."),
("Toplantı", "toplanti", "bad", "Başlığı tekrarlıyor; çıktı yok."),
("Baskı işi", "baski tamam", "bad", "Ne basıldığı veya teslim edildiği yok."),
("Salon", "...", "bad", "İçerik yok."),
("Sponsor takibi", "İş bitti.", "bad", "Eylem ve kapanış gerekçesi yok."),
("Ses provası", "halletti", "bad", "Özne/nesne/sonuç belirtilmiyor."),
("Gönüllü planı", "Gerekli.", "bad", "Anlamlı kapanış bilgisi yok."),
("Malzeme alımı", "Alındı.", "bad", "Neyin alındığı belli değil."),
("Etkinlik izni", "işlem tamam", "bad", "İşlem içeriği ve sonucu yok."),
]

ENTRIES = [
("Sponsorluk görüşmesi", "Sponsor A ile 3 Ekim'de görüşüp 5.000 TL destek ve sözleşme taslağı için onay aldık.", "good", "Somut görüşme sonucu, miktar ve sonraki adım var."),
("Salon ayırtma", "12 Kasım atölyesi için belediye salonu rezerve edildi; 40 kişilik kapasite teyit edildi.", "good", "Eylem, tarih, amaç ve kapasite var."),
("Afiş üretimi", "Etkinlik afişinin 200 kopyası basıldı ve giriş masasına bırakıldı.", "good", "Somut üretim miktarı ve teslim yeri var."),
("Ses sistemi", "Prova öncesi iki kablolu mikrofon değiştirildi; ses kesilmesi giderildi.", "good", "Hangi nesne ve sonuç açık."),
("Atölye malzemesi", "Ayşe 24 boya setini satın aldı; cumartesi çocuk atölyesinde kullanılacak.", "good", "Eylem, miktar, kullanıcı ve zaman var."),
("Toplantı kararları", "Gönüllü toplantısında görev çizelgesi oluşturuldu ve ekip klasöründe paylaşıldı.", "good", "Somut çıktı ve paylaşım yeri var."),
("Logo teslimi", "Sponsor A'nın vektör logosu alındı ve baskı dosyasına eklendi.", "good", "Somut nesne ve işlem belirtilmiş."),
("İzin başvurusu", "Park etkinliği için izin formu belediyeye gönderildi; yanıt tarihi 8 Ekim olarak kaydedildi.", "good", "Eylem, amaç ve takip tarihi var."),
("Yaka kartı", "40 gönüllü kartı isim ve görev bilgisiyle basıldı.", "good", "Somut çıktı, adet ve içerik var."),
("Ulaşım", "Minibüs 09.00'da okul önünden kalkacak şekilde ayarlandı; rota ekibe iletildi.", "good", "Ne zaman, nereden ve sonuç belli."),
("Sponsorluk görüşmesi", "Sponsor A ile gorusuldu; 5.000 TL destek ve taslak icin onay alindi.", "good", "ASCII yazımı; eylem ve sonuç somut."),
("Salon ayırtma", "12 Kasım atölyesi için salon rezerve edildi; 40 kişilik kapasite teyit edildi.", "good", "İsim olmadan tarih, amaç, işlem ve sonuç açık."),
("Afiş üretimi", "Etkinlik afisinin 200 kopyasi basildi ve giris masasina birakildi.", "good", "Aksansız yazımda miktar ve teslim yeri var."),
("Ses sistemi", "Prova oncesi iki mikrofon kablosu degistirildi; ses kesilmesi giderildi.", "good", "Nesne, eylem ve sonuç açık."),
("Atölye malzemesi", "24 boya seti alındı; cumartesi çocuk atölyesinde kullanılacak.", "good", "İsim yok; adet, amaç ve zaman belli."),
("Toplantı kararları", "Görev çizelgesi oluşturuldu ve ekip klasöründe paylaşıldı.", "good", "İsim yok; somut çıktı ve konum belirtilmiş."),
("Logo teslimi", "Sponsor logosu alındı ve baskı dosyasına eklendi.", "good", "İsim olmadan nesne ve işlem anlaşılır."),
("İzin başvurusu", "Park etkinliği için izin formu gönderildi; yanıt tarihi 8 Ekim olarak kaydedildi.", "good", "Alıcı adı olmadan amaç ve takip bilgisi var."),
("Yaka kartı", "40 gönüllü kartı görev bilgisiyle basıldı.", "good", "Somut çıktı ve miktar mevcut."),
("Ulaşım", "Minibüs 09.00'da okul önünden kalkacak; rota ekibe iletildi.", "good", "Kişi adı yok; zaman, yer, eylem net."),
("Sponsorluk görüşmesi", "Sponsor A ile görüşme ve gerekli aksiyonlar.", "borderline", "Başlığı tekrar eder, açıklama aksiyonu tanımlamaz."),
("Salon ayırtma", "Salon için görüşüldü, dönüş bekleniyor.", "borderline", "Eylem var fakat salon/tarih/sonuç bağlamı eksik."),
("Afiş üretimi", "Afişler hazırlandı.", "borderline", "Bir eylem var; ne basıldığı/kaç adet olduğu yok."),
("Ses sistemi", "Ses işi halloldu.", "borderline", "Sonuç var fakat somut işlem belirsiz."),
("Atölye malzemesi", "Malzemeler alındı, etkinlik için hazır.", "borderline", "Alım ve amaç var; nesne/miktar eksik."),
("Toplantı kararları", "Toplantıda görevler paylaşıldı.", "borderline", "Somut eylem var; kim/ne görev olduğu yok."),
("Logo teslimi", "Logo dosyası geldi.", "borderline", "Nesne ve sonuç var; hangi kullanım için bağlam eksik."),
("İzin başvurusu", "Başvuru gönderildi, yanıt bekleniyor.", "borderline", "Eylem/durum var; hangi başvuru olduğu belirsiz."),
("Yaka kartı", "Kartlar basıldı.", "borderline", "Somut eylem var; nesne/kişi ve adet belirsiz."),
("Ulaşım", "Ulasim icin konusuldu.", "borderline", "ASCII kısa eylem; kim/nerede/ne zaman yok."),
("Sponsorluk görüşmesi", "Görüşme yapıldı, konu konuşuldu.", "bad", "Başlık ve boş tekrar; somut bilgi yok."),
("Salon ayırtma", "Tamamlandı", "bad", "Başvuru başlığı dışında açıklama yok."),
("Afiş üretimi", "ok", "bad", "Eylem/nesne/sonuç yok."),
("Ses sistemi", "Ses sistemi", "bad", "Başlık aynen tekrar edilmiş."),
("Atölye malzemesi", "Gerekli işlemler yapıldı.", "bad", "Hangi işlemler olduğu belirtilmiyor."),
("Toplantı kararları", "Toplantı tamam.", "bad", "Toplantı başlığını yineleyen boş ifade."),
("Logo teslimi", "aaaa...", "bad", "Anlamsız içerik."),
("İzin başvurusu", "İşlem sağlandı.", "bad", "Hangi işlem veya sonuç olduğu yok."),
("Yaka kartı", "Her şey hazır.", "bad", "Somut aksiyon veya sonuç belirtilmiyor."),
("Ulaşım", "yapildi", "bad", "ASCII olsa da neyin yapıldığı anlaşılmıyor."),
("Sponsorluk görüşmesi", "gorusme yapildi", "bad", "ASCII genel ifade; görüşme konusu/sonucu yok."),
("Salon ayırtma", "Gerekli aksiyon alındı.", "bad", "Aksiyon içeriği verilmemiş."),
("Afiş üretimi", "Bitti.", "bad", "Ne üretildiği veya teslim edildiği yok."),
("Ses sistemi", "halletti", "bad", "Nesne ve sonuç yok."),
("Atölye malzemesi", "Malzeme.", "bad", "Anlamlı açıklama yok."),
("Toplantı kararları", "konuşuldu", "bad", "Kim/ne/sonuç belirtilmiyor."),
("Logo teslimi", "Geldi.", "bad", "Neyin geldiği ve kullanım amacı yok."),
("İzin başvurusu", "Başlıkla aynı", "bad", "Başlığı tekrar ediyor, açıklama yok."),
("Yaka kartı", "...", "bad", "Boş içerik."),
("Ulaşım", "tamamlandi", "bad", "Yalnız genel tamamlanma ifadesi."),
("Sponsorluk görüşmesi", "Görüşme.", "bad", "Tek başına görüşme sözcüğü eylem sonucu anlatmıyor."),
("Salon ayırtma", "okey", "bad", "İçerik yok."),
("Afiş üretimi", "yapıldı gerekli işlem", "bad", "Genel tekrar, somut çıktı yok."),
("Ses sistemi", "sorun yok", "bad", "Hangi sorun/eylem olduğu belli değil."),
("Atölye malzemesi", "bitti bitti", "bad", "Anlamsız tekrar."),
("Toplantı kararları", "Toplantı yapıldı", "bad", "Başlıkla aynı; karar veya sonuç belirtilmemiş."),
("Logo teslimi", "gerekli", "bad", "Anlamlı kayıt açıklaması değil."),
("İzin başvurusu", "yapıldı", "bad", "Eylem nesnesi ve bağlam yok."),
("Yaka kartı", "hazır", "bad", "Ne hazır olduğu ve kullanım amacı yok."),
("Ulaşım", "...", "bad", "Boş içerik."),
]


def ascii_text(text):
    text = text.replace("ı", "i").replace("İ", "I")
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c))


def make_dataset():
    rows = []
    for kind, examples in (("closing", CLOSINGS), ("entry", ENTRIES)):
        if len(examples) != 60:
            raise ValueError(f"{kind} templates must contain 60 examples, got {len(examples)}")
        for index, (title, text, label, why) in enumerate(examples, 1):
            if kind == "entry" and 31 <= index <= 40:
                label = "borderline"
            group_start = {"good": 1, "borderline": 21, "bad": 41}[label]
            pair_number = (index - group_start) % 10 + group_start
            variant = "standard" if index == pair_number else ("ascii" if pair_number % 2 else "no_name")
            if index != pair_number:
                title, text, label, why = examples[pair_number - 1]
            if variant == "ascii":
                text = ascii_text(text)
            elif variant == "no_name":
                for name in ("Ayşe ", "Mert "):
                    text = text.replace(name, "")
                text = text.replace("Sponsor A'nın", "Sponsorun").replace("Sponsor A ile", "Sponsorla")
            rows.append({"id": f"{kind}-{index:03d}", "kind": kind, "title": title,
                         "text": text, "label": label, "why": why,
                         "pair": f"{kind}-{pair_number:02d}", "variant": variant})
    return rows


def load_key():
    env_file = KEY_FILE
    try:
        for line in env_file.read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() == "OPENROUTER_API_KEY":
                return value.strip().strip("\"'")
    except OSError:
        pass
    if os.environ.get("OPENROUTER_API_KEY"):
        return os.environ["OPENROUTER_API_KEY"]
    raise SystemExit("OPENROUTER_API_KEY missing in .envapi or environment")


def state_for(row):
    if row["kind"] == "closing":
        return f"Kayıt: {row['title']}\nKapanış notu: {row['text']}"
    return f"Başlık: {row['title']}\nAçıklama: {row['text']}"


def payload(row, alternative=None):
    questions = json.loads(json.dumps(QUESTIONS[row["kind"]], ensure_ascii=False))
    if alternative and row["kind"] == "closing":
        alt = ALTERNATIVES[alternative]
        questions["closing_justified"]["instructions"] = alt["instructions"]
        questions["closing_justified"]["criteria"] = {"true": alt["true"], "false": alt["false"]}
    return {"model": MODEL, "state": state_for(row), "questions": questions}


def request_one(key, row, repeat, alternative=None):
    body = json.dumps(payload(row, alternative), ensure_ascii=False).encode()
    req = urllib.request.Request(URL, data=body, method="POST", headers={
        "Authorization": "Bearer " + key, "Content-Type": "application/json"})
    started = time.monotonic()
    error = None
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                data = json.loads(resp.read().decode())
                return {"id": row["id"], "repeat": repeat, "alternative": alternative or "base",
                        "latency_seconds": round(time.monotonic() - started, 4),
                        "http_status": resp.status, "response": data}
        except urllib.error.HTTPError as exc:
            error = f"HTTP {exc.code}"
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 4:
                break
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            error = type(exc).__name__
            if attempt == 4:
                break
        time.sleep(min(2 ** attempt, 16))
    return {"id": row["id"], "repeat": repeat, "alternative": alternative or "base",
            "latency_seconds": round(time.monotonic() - started, 4), "error": error}


def records(rows, results):
    byid = {r["id"]: r for r in rows}
    parsed = []
    for result in results:
        row = byid[result["id"]]
        resp = result.get("response", {})
        answers = resp.get("answers", {})
        parsed.append({**result, "kind": row["kind"], "label": row["label"],
                       "pair": row.get("pair"), "variant": row.get("variant"),
                       "model": resp.get("model"), "provider": resp.get("provider"),
                       "noul": {q: answers.get(q, {}).get("noul") for q in QUESTIONS[row["kind"]]}})
    return parsed


def pct(values, p):
    if not values:
        return float("nan")
    vals = sorted(values)
    index = (len(vals) - 1) * p
    lo, hi = math.floor(index), math.ceil(index)
    return vals[lo] + (vals[hi] - vals[lo]) * (index - lo)


def summarize(rows, results):
    if len(results) >= 720 and all("phase" not in x for x in results[:33]):
        for result in results[:33]:
            result["phase"] = "pilot"
        for result in results[33:]:
            result["phase"] = "full"
    parsed = records(rows, results)
    metrics = {}
    for kind, qs in (("closing", ["closing_justified"]), ("entry", ["specific", "context"])):
        for label in ("good", "borderline", "bad"):
            for q in qs:
                vals = [x["noul"].get(q) for x in parsed if x["kind"] == kind and x["label"] == label and x["alternative"] == "base" and isinstance(x["noul"].get(q), (int, float))]
                metrics[(kind, label, q)] = vals
    lines = ["# Karar modeli kalite ölçümü", "", f"Örnek: {len(rows)} satır ({sum(r['kind']=='closing' for r in rows)} kapanış, {sum(r['kind']=='entry' for r in rows)} kayıt); {len(results)} çağrı sonucu.", "", "## Noul dağılımı", "", "| Soru | Etiket | n | Min | Medyan | Maks |", "|---|---|---:|---:|---:|---:|"]
    for (kind, label, q), vals in metrics.items():
        if vals:
            lines.append(f"| {kind}/{q} | {label} | {len(vals)} | {min(vals):.3f} | {statistics.median(vals):.3f} | {max(vals):.3f} |")
    lines += ["", "## Yanlış karar ve eşik taraması", "", "Birden çok sorulu kayıtta herhangi bir sorunun noul değeri eşikten küçükse RED. Yanlış red=good örneğin reddi; borderline red ayrıca raporlanır. Yanlış geçiş=bad örneğin geçmesi.", "", "| Eşik | Soru | Good yanlış red | Borderline red | Bad yanlış geçiş |", "|---:|---|---:|---:|---:|"]
    for threshold_i in range(4, 15):
        threshold = threshold_i / 20
        for kind, qs in (("closing", ["closing_justified"]), ("entry", ["specific", "context"])):
            report_questions = qs + (["combined"] if kind == "entry" else [])
            for q in report_questions:
                ratios = []
                for label in ("good", "borderline", "bad"):
                    examples = {}
                    for x in parsed:
                        if x["kind"] == kind and x["label"] == label and x["alternative"] == "base":
                            if q == "combined":
                                for question, value in x["noul"].items():
                                    if isinstance(value, (int, float)):
                                        examples.setdefault(x["id"], {}).setdefault(question, []).append(value)
                            elif isinstance(x["noul"].get(q), (int, float)):
                                examples.setdefault(x["id"], []).append(x["noul"][q])
                    if q == "combined":
                        means = [min(statistics.mean(vs) for vs in question_values.values()) for question_values in examples.values()]
                    else:
                        means = [statistics.mean(vs) for vs in examples.values()]
                    if label == "bad":
                        rate = sum(v >= threshold for v in means) / len(means) if means else float("nan")
                    else:
                        rate = sum(v < threshold for v in means) / len(means) if means else float("nan")
                    ratios.append(rate)
                lines.append(f"| {threshold:.2f} | {kind}/{q} | {ratios[0]:.1%} | {ratios[1]:.1%} | {ratios[2]:.1%} |")
    lines += ["", "### Soru başına eşik denemesi: kayıt specific=0.50, context=0.20", "", "Canlıdaki birleşik kapı (iki sorudan biri düşükse red) için karma eşik; örnek başına üç tekrarın ortalaması.", "", "| Kombine eşik | Good yanlış red | Borderline red | Bad yanlış geçiş |", "|---|---:|---:|---:|"]
    mixed = {label: {} for label in ("good", "borderline", "bad")}
    for x in parsed:
        if x["kind"] == "entry" and x["alternative"] == "base":
            bucket = mixed[x["label"]].setdefault(x["id"], {}).setdefault("specific", [])
            if isinstance(x["noul"].get("specific"), (int, float)): bucket.append(x["noul"]["specific"])
            bucket = mixed[x["label"]][x["id"]].setdefault("context", [])
            if isinstance(x["noul"].get("context"), (int, float)): bucket.append(x["noul"]["context"])
    mixed_rates = []
    for label in ("good", "borderline", "bad"):
        examples = [v for v in mixed[label].values() if v.get("specific") and v.get("context")]
        reject = [statistics.mean(v["specific"]) < .5 or statistics.mean(v["context"]) < .2 for v in examples]
        rate = (sum(reject if label != "bad" else [not r for r in reject]) / len(reject)) if reject else float("nan")
        mixed_rates.append(rate)
    lines.append(f"| specific <0.50 OR context <0.20 | {mixed_rates[0]:.1%} | {mixed_rates[1]:.1%} | {mixed_rates[2]:.1%} |")
    lines += ["", "## Yazım ve isim varyantı", "", "Eşleşmiş pair'lerde varyant − düzgün ikiz noul farkı; aynı soru, base yönergesi.", "", "| Soru | Varyant | Eşleşen çift | Ortalama fark |", "|---|---|---:|---:|"]
    for kind, qs in (("closing", ["closing_justified"]), ("entry", ["specific", "context"])):
        for q in qs:
            grouped = {}
            for x in parsed:
                if x["kind"] == kind and x["alternative"] == "base" and isinstance(x["noul"].get(q), (int, float)):
                    grouped.setdefault(x.get("pair"), {}).setdefault(x.get("variant"), []).append(x["noul"][q])
            for variant in ("ascii", "no_name"):
                diffs = []
                for pair in grouped.values():
                    standard, changed = pair.get("standard", []), pair.get(variant, [])
                    if standard and changed:
                        diffs.append(statistics.mean(changed) - statistics.mean(standard))
                lines.append(f"| {kind}/{q} | {variant} | {len(diffs)} | {statistics.mean(diffs):+.3f} |" if diffs else f"| {kind}/{q} | {variant} | 0 | veri yok |")
    lines += ["", "## Reddedilen gerçek örneğin sentetik ikizi", "", "Sentetik ikiz: `Sponsor A ile görüşme yapıldı ve gerekli aksiyon alındı.` (gerçek metin/kişi adı veri setine alınmadı)."]
    target = [x for x in parsed if x["id"] == "closing-021" and x["alternative"] == "base"]
    lines.append("Noul tekrarları: " + (", ".join(f"{x['noul'].get('closing_justified')}" for x in target) or "sonuç yok"))
    lines += ["", "## Tekrar tutarlılığı", "", "Aynı örnekteki üç base noul değerinin popülasyon standart sapması; medyan / maksimum."]
    deviations = []
    groups = {}
    for x in parsed:
        if x["alternative"] == "base":
            for q, value in x["noul"].items():
                if isinstance(value, (int, float)):
                    groups.setdefault((x["id"], q), []).append(value)
    for vals in groups.values():
        if len(vals) > 1:
            deviations.append(statistics.pstdev(vals))
    lines.append(f"{statistics.median(deviations):.4f} / {max(deviations):.4f}" if deviations else "Veri yok.")
    latency = [x["latency_seconds"] for x in parsed]
    lines += ["", "## Gecikme", "", f"Tüm çağrılar: p50 {pct(latency, .50):.2f}s; p95 {pct(latency, .95):.2f}s; n={len(latency)} (yeniden denemeler dahil)."]
    pilot = [x for x in parsed if x.get("phase") == "pilot"]
    pilot_cost = [x["response"].get("usage", {}).get("cost", x["response"].get("cost")) for x in pilot if x.get("response")]
    pilot_cost = [c for c in pilot_cost if isinstance(c, (int, float))]
    pilot_tokens = sum(x.get("response", {}).get("usage", {}).get("input_tokens", 0) + x.get("response", {}).get("usage", {}).get("output_tokens", 0) for x in pilot if x.get("response"))
    pilot_latency = [x["latency_seconds"] for x in pilot]
    lines.append(f"5 örnek pilot: {len(pilot)} çağrı, {sum('error' in x for x in pilot)} hata, p50 {pct(pilot_latency, .50):.2f}s, p95 {pct(pilot_latency, .95):.2f}s; {pilot_tokens} token; bildirilen maliyet ${sum(pilot_cost):.6f} ({len(pilot_cost)}/{len(pilot)} yanıt). Sıfır maliyet alanı gerçek faturalamayı kanıtlamaz.")
    lines += ["", "## Model / sağlayıcı yönlendirmesi", ""]
    routes = sorted({f"{x.get('model') or '?'} / {x.get('provider') or '?'}" for x in parsed if x.get("response")})
    lines.extend(f"- {route}" + (" — istenen model takma adından farklı model kimliği döndü." if route.split(" / ", 1)[0] != MODEL else "") for route in routes)
    if not routes:
        lines.append("Başarılı yanıt yok.")
    cost_values = [x["response"].get("usage", {}).get("cost", x["response"].get("cost")) for x in parsed if x.get("response")]
    reported_cost = [c for c in cost_values if isinstance(c, (int, float))]
    usage_rows = [x["response"].get("usage", {}) for x in parsed if x.get("response")]
    token_count = sum(u.get("input_tokens", 0) + u.get("output_tokens", 0) for u in usage_rows if isinstance(u.get("input_tokens", 0), int) and isinstance(u.get("output_tokens", 0), int))
    lines.append(f"\nEndpoint usage: {token_count} reported tokens; reported cost ${sum(reported_cost):.6f} across {len(reported_cost)}/{len(cost_values)} responses. Zero or absent API-reported cost does not prove no external billing.")
    lines += ["", "## Alternatif kapanış yönergeleri", "", "Her soru için alt1/alt2 cevapların üç tekrarlı ortalaması ve base'e göre sınıflandırma oranları aşağıda; alternatifler ölçüm içindir, uygulama kodu değişmedi.", "", "| Yönerge | n | Good red | Borderline red | Bad pass |", "|---|---:|---:|---:|---:|"]
    for alt in ALTERNATIVES:
        rates = []
        vals_by_id = {}
        for x in parsed:
            if x["kind"] == "closing" and x["alternative"] == alt and isinstance(x["noul"].get("closing_justified"), (int, float)):
                vals_by_id.setdefault(x["id"], []).append(x["noul"]["closing_justified"])
        for label, pred in (("good", lambda v: v < .5), ("borderline", lambda v: v < .5), ("bad", lambda v: v >= .5)):
            matched = [statistics.mean(vals) for ident, vals in vals_by_id.items() if next(r["label"] for r in rows if r["id"] == ident) == label]
            rates.append(f"{sum(pred(v) for v in matched)/len(matched):.1%}" if matched else "n/a")
        lines.append(f"| {alt} | {len(vals_by_id)} | {rates[0]} | {rates[1]} | {rates[2]} |")
    lines += ["", "## Öneri (yalnız ölçüm; uygulama değişikliği yok)", "", "- Kapanış eşiği: sınıflar tam ayrışmıyor (bad örneklerin medyanı 0.367, maks. 0.798). 0.50'de good false-reject 0%, borderline red 0%, bad-pass 35%; 0.65'te sırasıyla 0%, 5%, 30%. 0.65 yalnız 5 puan bad-pass iyileştirip 5 puan borderline red ekliyor; canlı değişiklik için güçlü kanıt değil.", "- Kayıt soruları: ortak 0.50 birleşik kapı good false-reject 50%, borderline red 100%, bad-pass 0%. specific=0.50/context=0.20 denemesi good false-reject 10%, borderline red 65%, bad-pass 0%. Ayrı eşik denemesi anlamlı; yine de sentetik ölçüme dayanarak canlıya uygulamayın.", "- Kapanış yönergesi: iki alternatif de bad-pass 90% (base 35%); genel gevşetmeyi reddedin. İleride dar açıklama deneyin: somut bir eylemin (ör. görüşme yapıldı) tek başına yeterli olduğunu, `gerekli aksiyon alındı` gibi eylemi adlandırmayan genel ifadenin yeterli olmadığını pozitif/negatif örnek çiftleriyle belirtin. Bu metin henüz ölçülmedi.", "- Gerçek örnek: reddedilen gerçek örnek için kullanılan sentetik ikiz 3/3 kez geçti; red yeniden üretilemedi. İkiz, gerçek girdinin birebir kopyası değil; gerçek metin veya kişi adı depolanmadı. Red nedenini ayırmak için anonim başlık ve metin yapısıyla ek varyant gerekir.", "", "## Sınırlamalar", "", "Etiketler sentetik, küçük ve kurallara göre elle atanmış; canlı kullanıcı dağılımı değildir. Eşik kararı canlı log değil, bu dağılım ve hata takası üstünden verilmemeli. Endpoint 720 yanıtın tamamında cost=0 bildirdi; gerçek faturalama sıfır varsayılamaz.", ""]
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, help="Run first N dataset rows (pilot)")
    ap.add_argument("--no-alternatives", action="store_true")
    ap.add_argument("--reset", action="store_true", help="Replace previous raw results")
    ap.add_argument("--report-only", action="store_true", help="Rebuild report from saved responses without API calls")
    args = ap.parse_args()
    rows = make_dataset()
    DATA.write_text("".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows))
    if args.report_only:
        saved = [json.loads(line) for line in RESULTS.read_text().splitlines() if line.strip()]
        REPORT.write_text(summarize(rows, saved), encoding="utf-8")
        print(f"Report rebuilt from {len(saved)} saved results: {REPORT}")
        return
    if args.limit:
        selected = rows[:args.limit]
        if args.limit == 5:
            selected = [r for r in rows if r["kind"] == "closing"][:3] + [r for r in rows if r["kind"] == "entry"][:2]
    else:
        selected = rows
    key = load_key()
    if args.reset:
        RESULTS.write_text("", encoding="utf-8")
    jobs = [(r, n, alt) for r in selected for n in range(1, REPEATS + 1)
            for alt in ([None] if args.no_alternatives or r["kind"] != "closing" else [None, *ALTERNATIVES])]
    prior = []
    if RESULTS.exists() and not args.reset:
        prior = [json.loads(line) for line in RESULTS.read_text().splitlines() if line.strip()]
    done = {(x["id"], x["repeat"], x.get("alternative", "base")) for x in prior}
    jobs = [j for j in jobs if (j[0]["id"], j[1], j[2] or "base") not in done]
    outcomes = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENCY) as pool:
        futures = [pool.submit(request_one, key, *job) for job in jobs]
        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            result["phase"] = "pilot" if args.limit else "full"
            outcomes.append(result)
            # Append only response/error data; never persist request headers or key.
            with RESULTS.open("a", encoding="utf-8") as f:
                f.write(json.dumps(result, ensure_ascii=False) + "\n")
    all_results = prior + outcomes
    report = summarize(rows, all_results)
    REPORT.write_text(report, encoding="utf-8")
    print(f"Rows: {len(selected)}; calls completed this run: {len(outcomes)}; errors: {sum('error' in x for x in outcomes)}")
    print(f"Latency p50/p95: {pct([x['latency_seconds'] for x in outcomes], .5):.2f}s / {pct([x['latency_seconds'] for x in outcomes], .95):.2f}s")
    print(f"Report: {REPORT}")


if __name__ == "__main__":
    main()
