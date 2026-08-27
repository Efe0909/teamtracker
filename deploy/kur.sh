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
HOSTNAME_="${HOSTNAME_:-ekiptakip.efeatcali.com}"

mkdir -p "$OUT"
for f in nginx-ekiptakip.conf ekiptakip.service cloudflared-ornek.yml; do
  sed -e "s#/home/efe/projects/teamtracker#$REPO#g" \
      -e "s#^User=efe#User=$USER_NAME#" \
      -e "s#^Group=efe#Group=$USER_NAME#" \
      -e "s#/home/efe/.cloudflared#$HOME/.cloudflared#g" \
      -e "s#ekiptakip.efeatcali.com#$HOSTNAME_#g" \
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
  alan adı  : $HOSTNAME_

Sırayla:

  1) uygulama
     cd $REPO && make setup && make seed        # veritabanı yoksa
     sudo cp $OUT/ekiptakip.service /etc/systemd/system/
     sudo systemctl daemon-reload && sudo systemctl enable --now ekiptakip
     curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:$PORT_APP/m      # 200 bekle

  2) kapı + nginx   (Cloudflare Access kurduysan conf'taki auth_basic'i kapat)
     sudo htpasswd -c /etc/nginx/.htpasswd-ekiptakip $USER_NAME
     sudo cp $OUT/nginx-ekiptakip.conf /etc/nginx/sites-available/ekiptakip
     sudo ln -sf /etc/nginx/sites-available/ekiptakip /etc/nginx/sites-enabled/
     sudo nginx -t && sudo systemctl reload nginx
     curl -s -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:$PORT_NGINX/m    # 401 bekle
     curl -su $USER_NAME http://127.0.0.1:$PORT_NGINX/m -o /dev/null -w '%{http_code}\\n'  # 200

  3) tünel — $OUT/cloudflared-ornek.yml içindeki ingress satırlarını
     kendi ~/.cloudflared/config.yml dosyana ekle (son kural http_status:404 en altta kalsın)
     cloudflared tunnel route dns <tunel-adi> $HOSTNAME_
     sudo systemctl restart cloudflared
     curl -su $USER_NAME https://$HOSTNAME_/m -o /dev/null -w '%{http_code}\\n'  # 200

EOF
