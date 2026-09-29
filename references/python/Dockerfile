# EkipTakip uygulama imaji.
#
#   docker build -t ekiptakip:latest .
#
# Sema gocleri acilista kosar (app.py lifespan -> db.migrate()), ayri bir goc
# adimi yok. Tohum ve kullanici yonetimi icin compose'daki `seed` profili ve
# `docker compose run --rm app python tools/user.py ...` kullanilir.

FROM python:3.12-slim

# - PYTHONUNBUFFERED: log satirlari `docker logs`a aninda dussun.
# - PYTHONDONTWRITEBYTECODE: imajda .pyc birikmesin (katman sisiyor).
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Bagimliliklar once: kod degisince bu katman onbellekten gelir.
# psycopg[binary] tekerlekle geliyor, derleyici/libpq-dev gerekmiyor.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Kod. .dockerignore .venv, .git, testler ve yerel veritabani artiklarini eler.
COPY app.py ./
COPY shared/ ./shared/
COPY sites/ ./sites/
COPY tools/ ./tools/

# Root olarak kosma. Uygulama artik diske yaziyor (medya ekleri, KNOW-230
# kapandi): re-encode edilmis gorseller + kucuk resimler config.MEDIA_ROOT
# altina duser, konteynerde bu /data/media (EKIPTAKIP_MEDIA_ROOT,
# docker-compose.prod.yml). uid 10001 SABIT deger — host tarafinda bind
# mount edilen dizinin sahibi de ayni uid olmali, yoksa yazma EACCES ile
# patlar (bkz. deploy/nix-ekiptakip-media.nix, systemd.tmpfiles owner).
#
# /data/media'yi burada da olusturuyoruz ki imaj compose disinda (bare
# `docker run`, testler) calistirilinca da yazilabilir bir dizin bulsun;
# yayinda compose'un bind mount'u zaten bunun uzerine biner.
RUN useradd --create-home --uid 10001 ekiptakip \
 && mkdir -p /data/media \
 && chown -R ekiptakip:ekiptakip /app /data/media
USER ekiptakip

EXPOSE 8000

# /manifest.json kimlik gerektirmeyen paylasilan yollardan (config.SHARED_PATHS);
# saglik yoklamasi icin oturum acmadan cevap veren tek ucuz uc o.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/manifest.json', timeout=4).status == 200 else 1)"

# --workers 1 ZORUNLU: agac indeksi surec bellegindedir (spec/10-kararlar.md).
# Ikinci bir isci ikinci bir agac demek; replicas'i da 1'de birak.
#
# --forwarded-allow-ips: uvicorn X-Forwarded-Proto'yu YALNIZCA guvendigi bir
# adresten gelirse isler; varsayilani 127.0.0.1. Konteynerde nginx docker
# koprusunden geliyor (ornegin 192.168.97.1), yani varsayilanla baslik yok
# sayilir ve istek 'http' sanilir. Sonucu Google girisinde patlar:
# kimlik.py:162 redirect_uri'yi request.url_for ile kurar, Google'a
# http://.../giris/callback gider ve kayitli https adresiyle uyusmaz
# (redirect_uri_mismatch).
#
# '*' burada guvenli: compose uygulamayi yalnizca 127.0.0.1'e baglar, yani
# bu portu ancak ayni makinedeki nginx gorur. Konteyneri genis bir aga
# acarsan bunu nginx'in adresiyle daralt.
#
# NOT: denetim izi ve hiz siniri bu bayraga bagli DEGIL — onlar X-Real-IP
# basligini dogrudan okuyor (sertlestirme.py:66, kimlik.py:57).
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", \
     "--workers", "1", "--forwarded-allow-ips", "*"]
