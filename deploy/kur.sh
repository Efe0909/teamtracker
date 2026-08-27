#!/usr/bin/env bash
# Sablon dosyalardaki yollari BU makinedeki gercek yollarla degistirir.
# Hicbir sistem dosyasina dokunmaz — ciktilari deploy/olusan/ altina yazar,
# sonra kopyalama komutlarini ekrana basar. Kopyalamayi sen yaparsin.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$REPO/deploy/olusan"
USER_NAME="${SUDO_USER:-${USER:-$(id -un)}}"
PORT_APP="${PORT_APP:-8000}"
PORT_NGINX="${PORT_NGINX:-8080}"
ALAN="${ALAN:-polonyum.com}"                 # app.<ALAN> ve dashboard.<ALAN>
HOST_APP="${HOST_APP:-app.$ALAN}"
HOST_DASH="${HOST_DASH:-dashboard.$ALAN}"

mkdir -p "$OUT"
for f in nginx-ekiptakip.conf nginx-ekiptakip-ortak.conf ekiptakip.service cloudflared-ornek.yml; do
  sed -e "s#/home/efe/projects/teamtracker#$REPO#g" \
      -e "s#^User=efe#User=$USER_NAME#" \
      -e "s#^Group=efe#Group=$USER_NAME#" \
      -e "s#/home/efe/.cloudflared#$HOME/.cloudflared#g" \
      -e "s#app\.polonyum\.com#$HOST_APP#g" \
      -e "s#dashboard\.polonyum\.com#$HOST_DASH#g" \
      -e "s#=\.polonyum\.com#=.$ALAN#g" \
      -e "s#127.0.0.1:8000#127.0.0.1:$PORT_APP#g" \
      -e "s#--port 8000#--port $PORT_APP#g" \
      -e "s#127.0.0.1:8080#127.0.0.1:$PORT_NGINX#g" \
      "$REPO/deploy/$f" > "$OUT/$f"
done

cat <<EOF

Hazır: $OUT
  repo      : $REPO
  kullanıcı : $USER_NAME
  uygulama  : 127.0.0.1:$PORT_APP     nginx: 127.0.0.1:$PORT_NGINX
  mobil     : $HOST_APP
  masaüstü  : $HOST_DASH
  çerez     : .$ALAN

Sırayla:

  1) uygulama
     cd $REPO && make setup && make seed        # veritabanı yoksa
     sudo cp $OUT/ekiptakip.service /etc/systemd/system/
     sudo systemctl daemon-reload && sudo systemctl enable --now ekiptakip
     curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:$PORT_APP/m      # 200 bekle

  2) kapı + nginx   (Cloudflare Access kurduysan conf'taki auth_basic'i kapat)
     sudo htpasswd -c /etc/nginx/.htpasswd-ekiptakip $USER_NAME
     sudo mkdir -p /etc/nginx/snippets
     sudo cp $OUT/nginx-ekiptakip-ortak.conf /etc/nginx/snippets/ekiptakip-ortak.conf
     sudo cp $OUT/nginx-ekiptakip.conf /etc/nginx/sites-available/ekiptakip
     sudo ln -sf /etc/nginx/sites-available/ekiptakip /etc/nginx/sites-enabled/
     sudo nginx -t && sudo systemctl reload nginx
     curl -s  -H "Host: $HOST_APP" http://127.0.0.1:$PORT_NGINX/ -o /dev/null -w '%{http_code}\\n'  # 401
     curl -su $USER_NAME -H "Host: $HOST_APP"  http://127.0.0.1:$PORT_NGINX/         -o /dev/null -w '%{http_code}\\n'  # 200 mobil
     curl -su $USER_NAME -H "Host: $HOST_DASH" http://127.0.0.1:$PORT_NGINX/gorevler -o /dev/null -w '%{http_code}\\n'  # 200 masaüstü
     curl -su $USER_NAME -H "Host: bilinmeyen.host" http://127.0.0.1:$PORT_NGINX/    -o /dev/null -w '%{http_code}\\n'  # 000 (444)

  3) tünel — $OUT/cloudflared-ornek.yml içindeki kuralı kendi ~/.cloudflared/config.yml
     dosyana ekle. Catch-all kullanıyorsan MEVCUT kuralların onun üstünde kalsın;
     httpHostHeader KOYMA (Host'u sabitlerse nginx alan adlarını ayıramaz).
     cloudflared tunnel route dns <tunel-adi> $HOST_APP
     cloudflared tunnel route dns <tunel-adi> $HOST_DASH
     sudo systemctl restart cloudflared
     curl -su $USER_NAME https://$HOST_APP/       -o /dev/null -w '%{http_code}\\n'  # 200
     curl -su $USER_NAME https://$HOST_DASH/      -o /dev/null -w '%{http_code}\\n'  # 200

EOF
