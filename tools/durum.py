"""Veritabani durumu: disa aktar / sifirla / yukle (spec/80-veritabani.md §10).

Test kurulumunu tekrarlanabilir yapmak icin: ekrandaki durumu bir dosyaya al,
deneyi yap, dosyadan geri don.

  .venv/bin/python tools/durum.py disa-aktar                 # SQL'i ekrana bas
  .venv/bin/python tools/durum.py disa-aktar -o yedek        # tohumlar/yedek.sql
  .venv/bin/python tools/durum.py sifirla --evet             # BUTUN VERIYI SIL
  .venv/bin/python tools/durum.py yukle yedek                # tohumlar/yedek.sql
  .venv/bin/python tools/durum.py yukle varsayilan           # depodaki seed.py
  .venv/bin/python tools/durum.py sayimlar                   # tablo basina satir

Betik, uygulamanin baglandigi veritabaninin AYNISINA baglanir (DATABASE_URL).
Sunucu ayaktayken yukleme/sifirlama yaptiysan sunucuyu yeniden baslat: agac
indeksi surec belleginde durur (spec/10-kararlar.md, --workers 1).
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from shared import db, durum  # noqa: E402


def _onay(soru: str) -> bool:
    """Yikici islem icin acik onay. Boru hattinda --evet sart."""
    if not sys.stdin.isatty():
        return False
    return input(f"{soru} (evet/hayir): ").strip().lower() in ("evet", "e")


def _ozet(sayimlar: dict) -> str:
    dolu = {t: n for t, n in sayimlar.items() if n}
    return ", ".join(f"{t}={n}" for t, n in sorted(dolu.items())) or "(bos)"


def disa_aktar(cikti: str | None) -> None:
    icerik = durum.disa_aktar()
    if cikti is None:
        sys.stdout.write(icerik)                     # boruya uygun: yalniz SQL
        return
    hedef = durum.kaydet(cikti, icerik)
    print(f"yazildi: {hedef}  ({_ozet(durum.sayimlar())})", file=sys.stderr)


def sifirla(evet: bool) -> None:
    if not evet and not _onay("BÜTÜN VERİ SİLİNECEK. Onaylıyor musun?"):
        sys.exit("vazgecildi (onay icin --evet)")
    silinen = durum.sifirla()
    print(f"silindi: {', '.join(silinen)}")
    print("Not: sunucu ayaktaysa yeniden başlat (ağaç indeksi süreç belleğinde).")


def yukle(yol: str) -> None:
    try:
        sonuc = durum.yukle(yol)
    except FileNotFoundError as e:
        sys.exit(str(e))
    print(f"yuklendi: {sonuc['kaynak']}  ({_ozet(sonuc['sayimlar'])})")
    print("Not: sunucu ayaktaysa yeniden başlat (ağaç indeksi süreç belleğinde).")


def main() -> None:
    ap = argparse.ArgumentParser(description="EkipTakip veritabani durumu")
    alt = ap.add_subparsers(dest="komut", required=True)
    d = alt.add_parser("disa-aktar", help="durumu .sql tohum betigi olarak ver")
    d.add_argument("-o", "--cikti", help="dosya ya da ciplak ad (tohumlar/<ad>.sql); "
                                         "verilmezse ekrana basar")
    s = alt.add_parser("sifirla", help="butun veriyi sil (sema ve gocler durur)")
    s.add_argument("--evet", action="store_true", help="onay sorma")
    y = alt.add_parser("yukle", help="tohum betigini kostur")
    y.add_argument("yol", help="dosya, tohumlar/ altinda bir ad, ya da 'varsayilan'")
    alt.add_parser("sayimlar", help="tablo basina satir sayisi")
    a = ap.parse_args()

    db.havuz()
    db.gocler()                    # bos veritabanina yukleme yapilabilsin
    if a.komut == "disa-aktar":
        disa_aktar(a.cikti)
    elif a.komut == "sifirla":
        sifirla(a.evet)
    elif a.komut == "yukle":
        yukle(a.yol)
    else:
        print(_ozet(durum.sayimlar()))


if __name__ == "__main__":
    main()
