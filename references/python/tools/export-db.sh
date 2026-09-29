ssh efe@192.168.64.8 "docker exec -t ekiptakip-db pg_dump -U ekiptakip -d ekiptakip -s -F p -E UTF-8" > ../db-scheme-export.sql

