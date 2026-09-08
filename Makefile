# EkipTakip — yerel kaldirma. `make` yazinca ne var ne yok gorunur.
#
# Hizli yol:  make up      (kurulum + tohum + sunucu, tek komut)
# Gunluk yol: make dev     (sadece sunucu, --reload)

PY      ?= 3.12
VENV    ?= .venv
BIN     := $(VENV)/bin
HOST    ?= 127.0.0.1
PORT    ?= 8000
COMPOSE := docker compose
STAMP   := $(VENV)/.deps-ok
# Bagimlilik listesi burada DEGIL: requirements.txt (imaj da onu okuyor).
# requirements-dev.txt onu -r ile icerir ve ustune pytest ekler.
REQ     := requirements.txt requirements-dev.txt

.DEFAULT_GOAL := help
.PHONY: help up setup db-ac db-kapat seed reseed dev run test check clean distclean \
        imaj yayin-ac yayin-kapat yayin-log yayin-tohum

help:  ## bu listeyi goster
	@echo "EkipTakip — yerel komutlar"
	@echo
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*##/|/' | \
	  awk -F'|' '{printf "  \033[1m%-10s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  Degiskenler: PORT=$(PORT) HOST=$(HOST) PY=$(PY)"
	@echo "  Ornek: make dev PORT=9000"

up: setup db-ac seed dev  ## sifirdan kaldir: bagimliliklar + Postgres + tohum + sunucu

setup: $(STAMP)  ## sanal ortam + bagimliliklar (idempotent)

# Damga silinip bagimliliklar tazelenmek istendiginde (ya da $(VENV) yeni bir
# bagimliliktan eskiyse) buraya varolan bir sanal ortamla gelinir. Saglam ortam
# oldugu gibi birakilir; yarim kalmis bir dizin --allow-existing ile tamamlanir
# (`uv venv` yalin haliyle "A virtual environment already exists" deyip cikardi).
# --clear KULLANILMAZ: varolan ortami sessizce siler.
$(STAMP): $(REQ)
	@command -v uv >/dev/null || { echo "uv yok: https://docs.astral.sh/uv/ (curl -LsSf https://astral.sh/uv/install.sh | sh)"; exit 1; }
	@test -x $(BIN)/python || uv venv --python $(PY) --allow-existing $(VENV)
	uv pip install --python $(BIN)/python -r requirements-dev.txt
	@touch $@

db-ac: ## Postgres'i Docker'da kaldir (veri kalir)
	$(COMPOSE) up -d
	@printf "Postgres bekleniyor"; \
	 for i in $$(seq 1 30); do \
	   $(COMPOSE) exec -T db pg_isready -U ekiptakip -d ekiptakip >/dev/null 2>&1 && { echo " hazir"; exit 0; }; \
	   printf "."; sleep 1; done; echo; echo "Postgres acilmadi: docker compose logs db"; exit 1

db-kapat: ## Postgres'i durdur (veri kalir; silmek icin: docker compose down -v)
	$(COMPOSE) down

seed: $(STAMP)  ## veritabanini tohumla (VAROLAN VERI SILINIR)
	$(BIN)/python -m shared.seed

reseed: seed  ## veritabanini sifirla ve yeniden tohumla

# Gelistirmede kimlik SAHTE: Google anahtari olmadan calissin diye. Yayinda bu
# degisken acilisi reddettirir (spec/70-guvenlik.md §2.5).
dev: $(STAMP)  ## sunucuyu --reload ile calistir, SAHTE kimlikle (geliştirme)
	@echo "→ http://$(HOST):$(PORT)   ·   kimlik: SAHTE (yalnizca gelistirme)"
	EKIPTAKIP_AUTH=sahte EKIPTAKIP_ENV=gelistirme \
	  $(BIN)/uvicorn app:app --host $(HOST) --port $(PORT) --workers 1 --reload

run: $(STAMP)  ## sunucuyu --reload olmadan calistir
	$(BIN)/uvicorn app:app --host $(HOST) --port $(PORT) --workers 1

test: $(STAMP)  ## testleri kosur (pytest)
	$(BIN)/python -m pytest tests -q

check: $(STAMP)  ## uclar ayakta mi — sunucu calisirken baska terminalde
	@for u in / /gorevler /kazanim-agaci /pivot /takvim /tanimlar /arsiv /dosyalar /admin /whoami; do \
	  printf "%s %s\n" "$$(curl -s -o /dev/null -w '%{http_code}' http://$(HOST):$(PORT)$$u)" "$$u"; \
	done

# --- konteyner yigini (docker-compose.prod.yml) ---------------------------
# Bunlar UYGULAMAYI da konteynere alir; yukaridaki db-ac yalnizca Postgres'ti.
PROD := $(COMPOSE) -f docker-compose.prod.yml

imaj:  ## uygulama imajini kur (docker build)
	docker build -t ekiptakip:latest .

yayin-ac: ## konteyner yigini: uygulama + Postgres (127.0.0.1:$${APP_PORT:-8001})
	$(PROD) up -d --build

yayin-kapat: ## yigini durdur (veri kalir; silmek icin: ... down -v)
	$(PROD) down

yayin-log: ## uygulama gunlugunu izle
	$(PROD) logs -f app

yayin-tohum: ## yigindaki veritabanini tohumla (VAROLAN VERI SILINIR)
	$(PROD) --profile tohum run --rm seed

clean:  ## onbellekleri sil (veritabani Docker'da: docker compose down -v)
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
	rm -rf .pytest_cache

distclean: clean  ## sanal ortami da sil
	rm -rf $(VENV)
