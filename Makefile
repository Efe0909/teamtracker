# Yerel gelistirme (alpha-0.2): Postgres Docker'da, API cargo run, web vite.
#
#   make dev     hepsini ac + tarayicida http://localhost:5173 (Ctrl-C ikisini durdurur)
#   make seed    tohumu yeniden yukle — VAROLAN VERIYI SILER (yalniz yerel DB)
#
# Bos veritabaninda `dev` tohumu kendisi yukler; kullanici varsa dokunmaz.

DB   ?= ekiptakip_alpha02
URL  := postgresql://ekiptakip:ekiptakip@127.0.0.1:5432/$(DB)
PSQL := docker exec -i ekiptakip-db psql -U ekiptakip -d $(DB) -q
BIN  := backend/target/debug/ekiptakip

.PHONY: dev db api web seed seed-fresh

dev: db frontend/node_modules
	@n=$$($(PSQL) -tAc 'select count(*) from users' 2>/dev/null); [ "$${n:-0}" != 0 ] || $(MAKE) seed-fresh
	@( until nc -z 127.0.0.1 5173 2>/dev/null; do sleep 1; done; open http://localhost:5173 ) &
	@$(MAKE) -j2 api web

db:
	@docker compose -p teamtracker up -d --wait
	@docker exec ekiptakip-db psql -U ekiptakip -tAc "select 1 from pg_database where datname='$(DB)'" | grep -q 1 \
	  || docker exec ekiptakip-db createdb -U ekiptakip $(DB)

api:
	cd backend && DATABASE_URL=$(URL) EKIPTAKIP_AUTH=sahte cargo run

web:
	cd frontend && npm run dev

frontend/node_modules: frontend/package-lock.json
	cd frontend && npm install && touch node_modules

# Agac indeksi acilista kurulur: API calisiyorsa tohumdan sonra yeniden baslat.
seed: db
	$(PSQL) < backend/seed.sql

# Bos DB: semayi API'nin kendi gocleri kurar (sqlx sağlama toplamlariyla),
# API kapanir, tohum yuklenir; `dev` API'yi tohumlu agacla yeniden acar.
seed-fresh:
	cd backend && cargo build -q
	@DATABASE_URL=$(URL) EKIPTAKIP_AUTH=sahte $(BIN) & pid=$$!; \
	  until nc -z 127.0.0.1 8000 2>/dev/null; do sleep 1; done; kill $$pid
	$(PSQL) < backend/seed.sql
