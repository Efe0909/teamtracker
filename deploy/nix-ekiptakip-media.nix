{ ... }:

# EkipTakip — medya ekleri icin ek modul (bagimsiz, hazir yapistir).
#
#   imports = [ ./ekiptakip-media.nix ];
#
# ile flake.nix'teki vmtest/evsunucu modul listesine eklenir, baska hicbir
# sey degismez. modules/ekiptakip-app.nix'e DOKUNMUYORUZ — ayni servisin
# (systemd.services.ekiptakip) farkli alanlarini burada TAMAMLIYORUZ; NixOS
# modul sistemi ayni ismi birden fazla modulden genisletmeye izin verir,
# tek sart ayni yaprak anahtara (ayni "environment.X" veya "unitConfig.Y")
# iki modulun CAKISMAMASI — burada eklenenler (yeni bir ortam degiskeni,
# yeni bir unitConfig anahtari) ekiptakip-app.nix'in hic dokunmadigi
# alanlar, o yuzden guvenli.
#
# NEDEN AYRI DOSYA: teamtracker'daki sozlesme (media ekleri) bu depodan
# BAGIMSIZ gelisti; burayi ekiptakip-app.nix'e gomseydik iki repo arasinda
# senkron kaybolan tek bir buyuk dosya olurdu. Ayrica Samba karari (asagida,
# kapali) henuz verilmedi — o kararin gelecekteki karsiligi da kendi
# alaninda dursun, ana uygulama modulunu sismesin.
#
# ONEMLI — ayrica bak: teamtracker'daki deploy/DOCKER.md ve
# deploy/nginx-ekiptakip*.conf 10 MB'lik yuklemeyi kabul edecek sekilde
# guncellendi (client_max_body_size 12m). Bu depodaki
# modules/nginx/ekiptakip.nix HALA 2m — bu modul ona DOKUNMUYOR (baska
# dosya, benim sahipligimde degil). Bu modulu ice aktarmadan once ya da
# hemen sonra proxyBasliklari icindeki client_max_body_size'i elle 12m'e
# cikar, yoksa 2 MB'in ustundeki her yukleme nginx'te sessizce 413'e duser
# ve ekiptakip loglarinda hicbir iz birakmaz (ayni tuzak, teamtracker'in
# kendi nginx sablonlarinda da vardi).

let
  # Kalici ev: configuration.nix'teki fileSystems."/home/efe/sata" LABEL ILE
  # bagliyor (device = /dev/disk/by-label/sata) — gercek Pi'deki SATA disk
  # de, vmtest VM'indeki "sata" etiketli virtio disk de AYNI yola oturuyor.
  # Bu modul o path ustune tek bir alt dizin ekliyor, ikinci bir yol
  # uydurmuyor.
  sataKoku = "/home/efe/sata";
  medyaDizini = "${sataKoku}/ekiptakip/media";
in
{
  # --- dizin: uygulamanin uid'i sabit ---------------------------------------
  # Dockerfile'da uid 10001 SABIT (useradd --uid 10001 ekiptakip); host
  # tarafinda ayni sayiyi kullanmak zorundayiz cunku konteynerde o uid'e
  # karsilik gelen bir /etc/passwd kaydi yok — bind mount edilen dizinin
  # sahibi SAYISAL uid/gid ile eslesmeli, isimle degil.
  #
  # Iki satir (tek satir degil): "d" tipi systemd-tmpfiles ust dizini
  # OTOMATIK OLUSTURMUYOR diye guvenmek yerine ikisini de acikca yaziyoruz —
  # /home/efe/sata/ekiptakip henuz yoksa (ilk kurulum) root:root 0755 olarak
  # gelsin, altindaki media 10001:10001 olsun.
  systemd.tmpfiles.rules = [
    "d ${sataKoku}/ekiptakip 0755 root root -"
    "d ${medyaDizini} 0755 10001 10001 -"
  ];

  # --- servisi besle: EKIPTAKIP_MEDIA_DIR --------------------------------
  # docker-compose.prod.yml'deki satir:
  #   volumes: [ "${EKIPTAKIP_MEDIA_DIR:-./var/media}:/data/media" ]
  # Bu ${...} compose'un KENDI interpolasyonu — YAML'i calistiran surecin
  # ORTAM DEGISKENLERINE bakar (aynen `FOO=bar docker compose up` gibi).
  # ekiptakip-app.nix'teki `compose` degiskeni `--env-file ${sir}` veriyor
  # ama o bayrak yalnizca agenix'in coz dugu DOSYA icindeki KEY=VALUE
  # satirlarini besler — EKIPTAKIP_MEDIA_DIR o dosyada YOK ve olmamali
  # (sir degil, host'a ozgu bir yol). ekiptakip-app.nix zaten ayni ayrimi
  # EKIPTAKIP_ENV_FILE icin yasamis: o degisken de --env-file'daki dosyanin
  # ICINDE degil, systemd `environment.` alaninda duruyor, cunku compose
  # dosyasindaki `env_file: ${EKIPTAKIP_ENV_FILE:-.env}` satiri da AYNI
  # surec-ortami interpolasyonuyla cozuluyor. Ayni mekanizma, ikinci
  # degisken: `environment.` uzerinden gecen deger, `docker compose` alt
  # sureci baslatildiginda onun ortaminda hazir bulunuyor ve YAML'daki
  # ${...} referanslarini dolduruyor — --env-file'a hic ihtiyac yok, ayri
  # bir dosyaya da yazilmiyor.
  #
  # NOT: bu satir servisin ZATEN VAR OLAN `environment` kumesine bir anahtar
  # daha ekliyor (ekiptakip-app.nix'in ayarladigi EKIPTAKIP_ENV_FILE'in
  # yanina) — iki modul ayni alt-anahtara yazmadigi surece NixOS bunlari
  # birlestirir, cakisma olmaz.
  systemd.services.ekiptakip.environment.EKIPTAKIP_MEDIA_DIR = medyaDizini;

  # --- en onemli satir: disk yoksa servis hic ACILMASIN --------------------
  # SATA baglantisi `nofail` (configuration.nix) — 2026-08-30'da makineyi
  # acilamaz hale getiren tam da bu satirin YOKLUGUYDU, o yuzden nofail
  # BILEREK var ve KALACAK. Ama nofail'in bedeli su: disk fiziksel olarak
  # yoksa/gec taniniyorsa, systemd o mount'u sessizce ATLAR ve
  # /home/efe/sata rootfs'te (SD kart) sIradan BOS bir dizin olarak kalir.
  # Yukaridaki tmpfiles kurali bu durumda da calisir ve
  # /home/efe/sata/ekiptakip/media'yi SD KARTTA olusturur — uygulama bunu
  # ayirt edemez, MEDIA_ROOT yazilabilir bir dizin gorur ve mutlu mutlu
  # oraya yazmaya baslar. Sonuc: medya sessizce SD karta birikir, disk
  # takilana kadar kimse fark etmez, kart (spec: "High Endurance sinifi"
  # bile olsa) buyuk ikili dosyalarla asinir/dolar.
  #
  # RequiresMountsFor bunu SERTLESTIRIR: systemd, belirtilen yolu kapsayan
  # mount unit'i basarili olana kadar bu servisi baslatmaz (ayrica o mount
  # coker/kalkarsa servisi de durdurur). nofail "acilisi engelleme"
  # demekti, RequiresMountsFor ise "bu servis o disk olmadan YOK sayilsin"
  # demek — ikisi celismiyor, ikinci birinciyi TAMAMLIYOR: makine diskssiz
  # de acilir (nofail), ama ekiptakip diskssiz acilmaz (RequiresMountsFor).
  # Sonuc gorunur bir `systemctl --failed` olur, sessiz bir SD kart
  # dolumu degil.
  systemd.services.ekiptakip.unitConfig.RequiresMountsFor = sataKoku;

  # ============================================================ SAMBA (KAPALI) ==
  # Sozlesme (madde 1, "Storage"): "Samba, if ever enabled, only re-exports
  # the same directory read-only." Asagisi TAMAMEN yorum satiri — Samba
  # bugun configuration.nix'te de kapali (services.samba.enable = false),
  # acmak ayri bir karar ve bu modulun isi degil. Acmaya karar verirsen:
  #
  # 1. Yalnizca MEDYA dizinini paylas, butun /home/efe/sata'yi degil —
  #    /home/efe/sata altinda yedekler de var (services.restic.backups.yerel,
  #    configuration.nix), onlari agda gezilebilir yapmanin hicbir faydasi
  #    yok, riski var.
  # 2. "read only" = "yes" SART, "no" DEGIL. Bu bytelari sahiplenen tek
  #    surec ekiptakip konteyneri (uid 10001) — Samba'dan yazma acarsan iki
  #    yazar (uygulama + SMB istemcisi) ayni dosyalara farkli yollardan
  #    dokunur, storage_key/thumb_key varsayimlari (sozlesme §2, "Absolute
  #    paths are never stored... relative paths only") bir SMB istemcisinin
  #    dosya TASIMASI/SILMESI karsisinda sessizce bozulur.
  #
  # services.samba = {
  #   enable = true;
  #   settings.ekiptakip-medya = {
  #     path = "/home/efe/sata/ekiptakip/media";
  #     browseable = "yes";
  #     "read only" = "yes";
  #     "valid users" = "efe";
  #   };
  # };
  #
  # configuration.nix bu ikisini SAMBA ACILINCA diye kendi yorumlarinda
  # zaten ongoruyor (avahi: "samba ile birlikte acilir"; firewall:
  # "Samba acilirsa: ... 139 445"). 80 zaten configuration.nix'te tanimli
  # oldugu icin burada YALNIZCA 139/445 var — liste tipli secenekler NixOS'ta
  # modul basina EKLENIR (uzerine yazilmaz), yani acildiginda sonuc
  # [ 80 139 445 ] olur, 80 tekrar yazilmaz.
  #
  # services.avahi.enable = true;
  # networking.firewall.interfaces."tailscale0".allowedTCPPorts = [ 139 445 ];
}
