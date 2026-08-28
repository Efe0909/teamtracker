# EkipTakip — yerel kaldirma. `make` yazinca ne var ne yok gorunur.
#
# Hizli yol:  make up      (kurulum + tohum + sunucu, tek komut)
# Gunluk yol: make dev     (sadece sunucu, --reload)

PY      ?= 3.12
VENV    ?= .venv
BIN     := $(VENV)/bin
HOST    ?= 127.0.0.1
PORT    ?= 8000
DB      := ekiptakip.db
STAMP   := $(VENV)/.deps-ok
DEPS    := fastapi uvicorn[standard] jinja2 python-multipart pytest httpx \
           authlib itsdangerous          # kimlik: OIDC + imzali oturum

.DEFAULT_GOAL := help
.PHONY: help up setup seed reseed dev run test check clean distclean

help:  ## bu listeyi goster
	@echo "EkipTakip — yerel komutlar"
	@echo
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | sed 's/:.*##/|/' | \
	  awk -F'|' '{printf "  \033[1m%-10s\033[0m %s\n", $$1, $$2}'
	@echo
	@echo "  Degiskenler: PORT=$(PORT) HOST=$(HOST) PY=$(PY)"
	@echo "  Ornek: make dev PORT=9000"

up: setup $(DB) dev  ## sifirdan kaldir: kurulum + tohum (yoksa) + sunucu

setup: $(STAMP)  ## sanal ortam + bagimliliklar (idempotent)

$(STAMP):
	@command -v uv >/dev/null || { echo "uv yok: https://docs.astral.sh/uv/ (curl -LsSf https://astral.sh/uv/install.sh | sh)"; exit 1; }
	uv venv --python $(PY) $(VENV)
	uv pip install --python $(BIN)/python $(DEPS)
	@touch $@

# sadece veritabani YOKKEN tohumlar — varolani sessizce silmez (bunun icin: make reseed)
$(DB): $(STAMP)
	@$(MAKE) --no-print-directory seed

seed: $(STAMP)  ## veritabanini tohumla (VAROLAN ekiptakip.db SILINIR)
	$(BIN)/python -m shared.seed

reseed: clean seed  ## veritabanini sifirla ve yeniden tohumla

dev: $(STAMP)  ## sunucuyu --reload ile calistir (varsayilan http://127.0.0.1:8000)
	@echo "→ http://$(HOST):$(PORT)  (ana sayfa)   ·   /gorevler  (gorev yoneticisi)"
	$(BIN)/uvicorn app:app --host $(HOST) --port $(PORT) --workers 1 --reload

run: $(STAMP)  ## sunucuyu --reload olmadan calistir
	$(BIN)/uvicorn app:app --host $(HOST) --port $(PORT) --workers 1

test: $(STAMP)  ## testleri kosur (pytest)
	$(BIN)/python -m pytest tests -q

check: $(STAMP)  ## uclar ayakta mi — sunucu calisirken baska terminalde
	@for u in / /gorevler /kazanim-agaci /pivot /takvim /tanimlar /arsiv /dosyalar /admin /whoami; do \
	  printf "%s %s\n" "$$(curl -s -o /dev/null -w '%{http_code}' http://$(HOST):$(PORT)$$u)" "$$u"; \
	done

clean:  ## veritabanini ve __pycache__ sil
	rm -f $(DB)
	find . -name __pycache__ -type d -prune -exec rm -rf {} +
	rm -rf .pytest_cache

distclean: clean  ## sanal ortami da sil
	rm -rf $(VENV)
