"""Veritabani durumunu SQL'e cevirir, sifirlar, geri yukler — TEST ARACI.

HTTP yuzu shared/test_uclari.py (yalnizca gelistirmede tanimlanir). Mantik
burada durur ki betikten de cagrilabilsin ve testi HTTP'siz yazilabilsin.

Uc karar:

1. **Sema disa aktarilmaz, yalnizca VERI.** Semanin kaynagi numarali gocler
   (spec/80-veritabani.md §4); dump'tan sema yazmak ikinci bir dogruluk kaynagi
   yaratirdi. Yuklenen dosya bos ama GOCU YAPILMIS bir veritabani bekler.

2. **Tablo sirasi ve dongu kirma calisma aninda bulunur.** Sabit liste yazsak
   sema buyudukce sessizce eskirdi; sira information_schema'daki yabanci
   anahtarlardan topolojik olarak cikarilir. `users.scope_node_id` <-> `nodes`
   dongusu ve `nodes.parent_id` oz-referansi ayni yolla cozulur: sutun once
   NULL yazilir, dosyanin sonunda UPDATE ile baglanir (seed.py'nin elle yaptigi
   sey, genellestirilmis hali).

3. **Deger kacislari elle yazilmaz.** psycopg'nin kendi literal uyarlayicisi
   (sql.Literal) kullanilir: tarih, uuid, inet, bool, None hepsi dogru tipte
   ciktiya doner.
"""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from psycopg import sql

from . import config, db

# Goc defteri durumun parcasi degil: yuklenen dosya semayi degil veriyi tasir.
KORUNAN = frozenset({"schema_migrations"})


# --- sema kesfi -----------------------------------------------------------


def _tablolar(c) -> list[str]:
    return [r["table_name"] for r in c.execute(
        "select table_name from information_schema.tables"
        " where table_schema = 'public' and table_type = 'BASE TABLE'"
        " order by table_name").fetchall()
        if r["table_name"] not in KORUNAN]


def _sutunlar(c, tablo: str) -> list[dict]:
    """Yazilabilir sutunlar. Uretilmis sutun (items.arama) INSERT'e giremez."""
    return c.execute(
        "select column_name ad, is_nullable = 'YES' bos_olabilir"
        " from information_schema.columns"
        " where table_schema = 'public' and table_name = %s"
        "   and is_generated <> 'ALWAYS'"
        " order by ordinal_position", (tablo,)).fetchall()


def _yabanci_anahtarlar(c) -> list[dict]:
    """(tablo, sutun, hedef tablo) uculleri — sirayi bunlar belirler."""
    return c.execute(
        "select tc.table_name tablo, kcu.column_name sutun,"
        "       ccu.table_name hedef"
        " from information_schema.table_constraints tc"
        " join information_schema.key_column_usage kcu"
        "   on kcu.constraint_name = tc.constraint_name"
        "  and kcu.table_schema = tc.table_schema"
        " join information_schema.constraint_column_usage ccu"
        "   on ccu.constraint_name = tc.constraint_name"
        "  and ccu.table_schema = tc.table_schema"
        " where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'"
    ).fetchall()


def _birincil_anahtar(c, tablo: str) -> list[str]:
    return [r["column_name"] for r in c.execute(
        "select kcu.column_name from information_schema.table_constraints tc"
        " join information_schema.key_column_usage kcu"
        "   on kcu.constraint_name = tc.constraint_name"
        "  and kcu.table_schema = tc.table_schema"
        " where tc.constraint_type = 'PRIMARY KEY' and tc.table_schema = 'public'"
        "   and tc.table_name = %s"
        " order by kcu.ordinal_position", (tablo,)).fetchall()]


def yazma_plani(c) -> tuple[list[str], dict[str, set[str]]]:
    """(tablo sirasi, ertelenen sutunlar) hesaplar.

    Topolojik siralama; kalan her dongude dongudeki NULL alabilen bir yabanci
    anahtar sutunu ERTELENIR (once null yazilir, sonra UPDATE). Oz-referanslar
    (nodes.parent_id) bastan ertelenir: satir sirasina bagli kalmayalim.
    """
    tablolar = _tablolar(c)
    bos_olabilir = {(t, s["ad"]): s["bos_olabilir"] for t in tablolar for s in _sutunlar(c, t)}

    ertelenen: dict[str, set[str]] = {}
    baglar: dict[str, set[tuple[str, str]]] = {t: set() for t in tablolar}   # tablo -> {(hedef, sutun)}
    for fk in _yabanci_anahtarlar(c):
        t, s, hedef = fk["tablo"], fk["sutun"], fk["hedef"]
        if t not in baglar or hedef in KORUNAN:
            continue
        if t == hedef:                       # oz-referans: satir sirasina guvenme
            _ertele(ertelenen, bos_olabilir, t, s)
            continue
        baglar[t].add((hedef, s))

    sira: list[str] = []
    kalan = set(tablolar)
    while kalan:
        hazir = sorted(t for t in kalan
                       if not {h for h, _ in baglar[t] if h in kalan and h != t})
        if hazir:
            sira.extend(hazir)
            kalan.difference_update(hazir)
            continue
        # Hicbir tablo hazir degilse kalanlarda bir DONGU vardir. Gelisiguzel bir
        # kenari degil, dongunun UZERINDEKI bir kenari kir: yoksa dongude olmayan
        # sutunlar da bosuna ertelenirdi.
        halka = _dongu(baglar, kalan)
        aday = sorted((t, s) for t, s, _ in halka if bos_olabilir.get((t, s)))
        if not aday:
            raise RuntimeError(
                "Tablo sirasi cozulemedi: dongudeki hicbir yabanci anahtar NULL "
                f"alamiyor. Dongu: {halka}")
        tablo, sutun = aday[0]
        _ertele(ertelenen, bos_olabilir, tablo, sutun)
        baglar[tablo] = {(h, s) for h, s in baglar[tablo] if s != sutun}
    return sira, ertelenen


def _dongu(baglar: dict, kalan: set) -> list[tuple[str, str, str]]:
    """Kalan grafikte bir dongu bulur: [(tablo, sutun, hedef), …]. Yoksa []."""
    yigin: list[str] = []
    bitti: set[str] = set()

    def kenarlar(halka: list[str]) -> list[tuple[str, str, str]]:
        out = []
        for a, b in zip(halka, halka[1:]):
            out.append((a, min(s for h, s in baglar[a] if h == b), b))
        return out

    def git(t: str) -> list[tuple[str, str, str]]:
        yigin.append(t)
        for hedef, _s in sorted(baglar[t]):
            if hedef not in kalan or hedef == t or hedef in bitti:
                continue
            if hedef in yigin:                       # geri kenar: dongu kapandi
                bas = yigin.index(hedef)
                return kenarlar(yigin[bas:] + [hedef])
            bulunan = git(hedef)
            if bulunan:
                return bulunan
        yigin.pop()
        bitti.add(t)
        return []

    for t in sorted(kalan):
        if t in bitti:
            continue
        bulunan = git(t)
        if bulunan:
            return bulunan
    return []


def _ertele(ertelenen, bos_olabilir, tablo: str, sutun: str) -> None:
    if not bos_olabilir.get((tablo, sutun)):
        raise RuntimeError(f"{tablo}.{sutun} ertelenmeli ama NOT NULL — "
                           "bu semayi disa aktaramayiz.")
    ertelenen.setdefault(tablo, set()).add(sutun)


# --- disa aktarma ---------------------------------------------------------


def disa_aktar() -> str:
    """Butun veriyi tek bir .sql tohum betigi olarak dondurur."""
    with db.havuz().connection() as c:
        sira, ertelenen = yazma_plani(c)
        satirlar = [
            "-- EkipTakip durum disa aktarimi — "
            f"{datetime.now(timezone.utc).isoformat(timespec='seconds')}",
            "-- Ureten: shared/durum.py (GET /test/disa-aktar). YALNIZCA VERI:",
            "-- sema goclerden gelir, bu dosya gocu yapilmis bos bir veritabani bekler.",
            "-- Geri yukle: POST /test/yukle?yol=<dosya>",
            "",
            "begin;",
        ]
        if sira:
            satirlar.append("truncate table {} restart identity cascade;".format(
                ", ".join(sql.Identifier(t).as_string(c) for t in sira)))

        sonradan: list[str] = []
        for tablo in sira:
            gecikenler = ertelenen.get(tablo, set())
            sutunlar = [s["ad"] for s in _sutunlar(c, tablo)]
            rows = c.execute(sql.SQL("select * from {}").format(
                sql.Identifier(tablo))).fetchall()
            satirlar += ["", f"-- {tablo}: {len(rows)} satir"]
            if not rows:
                continue
            pk = _birincil_anahtar(c, tablo)
            for r in rows:
                yazilan = [s for s in sutunlar if s not in gecikenler]
                satirlar.append("insert into {} ({}) values ({});".format(
                    sql.Identifier(tablo).as_string(c),
                    ", ".join(sql.Identifier(s).as_string(c) for s in yazilan),
                    ", ".join(sql.Literal(r[s]).as_string(c) for s in yazilan)))
                sonradan += _gecikmis_update(c, tablo, r, gecikenler, pk)

        if sonradan:
            satirlar += ["", "-- donguyu kiran sutunlar: satirlar yazildi, simdi baglaniyor",
                         *sonradan]
        satirlar += ["", "commit;", ""]
        return "\n".join(satirlar)


def _gecikmis_update(c, tablo: str, r: dict, gecikenler: set[str], pk: list[str]) -> list[str]:
    """Ertelenen sutunlar icin sondaki UPDATE satirlari."""
    dolu = {s: r[s] for s in gecikenler if r[s] is not None}
    if not dolu:
        return []
    if not pk:
        raise RuntimeError(f"{tablo}: ertelenen sutun var ama birincil anahtar yok.")
    return ["update {} set {} where {};".format(
        sql.Identifier(tablo).as_string(c),
        ", ".join(f"{sql.Identifier(s).as_string(c)} = {sql.Literal(v).as_string(c)}"
                  for s, v in sorted(dolu.items())),
        " and ".join(f"{sql.Identifier(k).as_string(c)} = {sql.Literal(r[k]).as_string(c)}"
                     for k in pk))]


# --- sifirlama ------------------------------------------------------------


def sifirla() -> list[str]:
    """Butun veriyi siler. Sema ve goc defteri DURUR — yeniden goc gerekmez."""
    with db.havuz().connection() as c:
        adlar = _tablolar(c)
        if adlar:
            c.execute(sql.SQL("truncate table {} restart identity cascade").format(
                sql.SQL(", ").join(sql.Identifier(t) for t in adlar)))
    return adlar


# --- yukleme --------------------------------------------------------------

VARSAYILAN = "varsayilan"          # depodaki tohum (shared/seed.py)


def guvenli_yol(yol: str) -> Path:
    """Verilen yolu tohum dizinine hapseder.

    Bu uc, dosyadaki SQL'i oldugu gibi kosturur; "hangi dosya" sorusu bu yuzden
    guvenlik sorusudur. Iki kural: uzanti .sql olacak ve COZULMUS yol tohum
    dizininin altinda kalacak (resolve() sembolik baglari da cozer, yani disari
    isaret eden bir baglanti buradan gecmez).
    """
    kok = Path(config.TOHUM_DIZINI).resolve()
    p = Path(yol)
    p = (p if p.is_absolute() else kok / p).resolve()
    if not p.is_relative_to(kok):
        raise PermissionError(f"tohum dizini disinda: {yol}")
    if p.suffix != ".sql":
        raise ValueError("yalnizca .sql dosyasi yuklenir")
    if not p.is_file():
        raise FileNotFoundError(str(p))
    return p


def yukle(yol: str) -> dict:
    """Tohum betigini kosturur ve agac indeksini yeniden kurar.

    `yol == "varsayilan"` ise depodaki shared/seed.py calisir — sifirladiktan
    sonra bilinen bir duruma donmenin kisa yolu.
    """
    from . import seed, service                     # dairesel import olmasin

    if yol == VARSAYILAN:
        seed.run()
        kaynak = "shared/seed.py"
    else:
        dosya = guvenli_yol(yol)
        db.calistir(dosya.read_text(encoding="utf-8"))
        kaynak = str(dosya)

    # Agac surec bellegindedir (spec/10-kararlar.md): veri degistiyse yeniden
    # kurulmali, yoksa sayfalar eski dugum kimlikleriyle bos doner.
    service.rebuild_tree()
    return {"kaynak": kaynak, "sayimlar": sayimlar()}


def sayimlar() -> dict[str, int]:
    """Tablo basina satir sayisi — uclarin cevabinda 'ne oldu' ozeti."""
    with db.havuz().connection() as c:
        out = {}
        for t in _tablolar(c):
            r = c.execute(sql.SQL("select count(*) c from {}").format(
                sql.Identifier(t))).fetchone()
            out[t] = r["c"]
        return out


def kaydet(ad: str, icerik: str) -> Path:
    """Disa aktarimi tohum dizinine yazar.

    Ad'da ayirici olamaz (yalnizca harf/rakam/-/_), dolayisiyla dosya tohum
    dizininden disari cikamaz — yazma tarafinda yol cozumlemesine gerek yok.
    """
    if not ad or not ad.replace("-", "").replace("_", "").isalnum():
        raise ValueError("ad yalnizca harf, rakam, '-' ve '_' icerebilir")
    kok = Path(config.TOHUM_DIZINI)
    kok.mkdir(parents=True, exist_ok=True)
    hedef = kok / f"{ad}.sql"
    hedef.write_text(icerik, encoding="utf-8")
    return hedef
