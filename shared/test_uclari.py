"""Durum uclari — YALNIZCA GELISTIRME/TEST (spec/70-guvenlik.md §12).

Uc uc:
    GET  /test/disa-aktar   butun durumu tek .sql tohum betigi olarak verir
    POST /test/sifirla      butun veriyi siler (sema ve gocler durur)
    POST /test/yukle?yol=…  verilen tohum betigini kosturur

Kapilar (uc ayri katman, hepsi ayni yone bakar):

1. **Rota yoksa saldiri yuzeyi de yok.** Router app.py'de yalnizca
   `config.durum_uclari()` dogruyken eklenir: yayin kurulumunda ya da
   EKIPTAKIP_ENV=gelistirme degilken bu yollar 404'tur, 403 bile degil.
   Anahtar yayinda tanimliysa surec ACILMAZ (config.dogrula).
2. **Anahtar.** Her istek `X-Test-Anahtari` basligini tasir; karsilastirma
   sabit zamanli. Baslik secildi, sorgu parametresi degil: anahtar tarayici
   gecmisine ve erisim gunluklerine dusmesin.
3. **Arayuze baglanmaz.** Sablonlarda dugme/baglanti yok; bunlar makine
   uclari — kullanan test kosumu ya da elle atilan bir curl.

Giris kapisi ve CSRF muafiyeti bilincli: `sifirla` kullanicilari da siler,
yani oturuma bagli bir uc kendi kendini kilitlerdi; yerine anahtar geciyor.
"""
from __future__ import annotations

import hmac

import psycopg
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse, PlainTextResponse

from . import config, durum

BASLIK = "x-test-anahtari"
ONEK = "/test/"


def anahtar_dogrula(request: Request) -> None:
    """Anahtar yoksa/yanlissa 403. Uc kapali ise (nasil olduysa) yine 403.

    Karsilastirma BAYT uzerinden: baslikler latin-1 cozulur, ASCII disi bir
    karakter compare_digest'i metin modunda patlatir (403 yerine 500 olurdu).
    """
    gelen = (request.headers.get(BASLIK) or "").encode("utf-8", "replace")
    if not config.durum_uclari() or not hmac.compare_digest(
            gelen, config.TEST_ANAHTARI.encode("utf-8")):
        raise HTTPException(403, "test anahtarı geçersiz")


router = APIRouter(prefix="/test", dependencies=[Depends(anahtar_dogrula)],
                   include_in_schema=False)


@router.get("/disa-aktar", response_class=PlainTextResponse)
def disa_aktar(ad: str | None = Query(None, description="verilirse tohumlar/<ad>.sql'e de yazar")):
    """Durumu SQL olarak dondurur; `ad` verilirse tohum dizinine de kaydeder."""
    icerik = durum.disa_aktar()
    basliklar = {}
    if ad:
        try:
            basliklar["X-Tohum-Yolu"] = str(durum.kaydet(ad, icerik))
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
    return PlainTextResponse(icerik, headers=basliklar,
                             media_type="text/plain; charset=utf-8")


@router.post("/sifirla")
def sifirla():
    """Butun veriyi siler. Sema ve goc defteri durur; yeniden goc gerekmez."""
    from . import service                            # dairesel import olmasin

    silinen = durum.sifirla()
    service.rebuild_tree()                           # agac surec bellegindeydi
    return JSONResponse({"silinen": silinen, "sayimlar": durum.sayimlar()})


@router.post("/yukle")
def yukle(yol: str = Query(..., description="tohumlar/ altinda bir .sql, ya da 'varsayilan'")):
    """Tohum betigini kosturur (tohum dizini disina cikilamaz)."""
    try:
        return JSONResponse(durum.yukle(yol))
    except PermissionError as e:
        raise HTTPException(403, str(e)) from e
    except FileNotFoundError as e:
        raise HTTPException(404, f"tohum yok: {e}") from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except psycopg.Error as e:
        # Bozuk tohum betigi 500 + traceback degil, okunur bir hata donsun:
        # bunu okuyan bir test kosumu ya da elle curl atan biri.
        raise HTTPException(400, f"tohum betigi calismadi: {e}") from e
