{ config, lib, pkgs, ... }:

# EkipTakip — NixOS modulu: Rust API + yerel PostgreSQL, konteyner YOK.
#
#   modules = [ teamtracker.nixosModules.default ];
#   services.ekiptakip = {
#     enable = true;
#     package = teamtracker.packages.aarch64-linux.default;   # release.sh'in pini
#     environmentFile = config.age.secrets."ekiptakip-env".path;
#   };
#
# nginx ve cloudflared BURADA YOK — makineye ozel, ~/nix'te kalir. nginx
# `webRoot`'u statik verir, `/api/`'yi 127.0.0.1:<port>'a vekiller.
#
# Veritabani sifresi YOK: servis `ekiptakip` sistem kullanicisi olarak calisir,
# Postgres unix soketinde ayni adli role'e peer ile alir. Yeni sir dosyasi
# gerekmez; eski compose'un POSTGRES_PASSWORD'u artik kullanilmaz.

let
  cfg = config.services.ekiptakip;
in
{
  options.services.ekiptakip = {
    enable = lib.mkEnableOption "EkipTakip (Rust backend)";

    # Varsayilan YOK: kaynaktan derleyen bir varsayilan, hedef makinede
    # (Pi) sessizce derleme baslatirdi.
    package = lib.mkOption {
      type = lib.types.package;
      description = "Release paketi: bin/ekiptakip + share/ekiptakip/web.";
    };

    webRoot = lib.mkOption {
      type = lib.types.path;
      readOnly = true;
      default = "${cfg.package}/share/ekiptakip/web";
      defaultText = lib.literalExpression ''"''${package}/share/ekiptakip/web"'';
      description = "On yuz derlemesi (React). nginx `root` olarak verir.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.path;
      description = ''
        Sirlar: EKIPTAKIP_SECRET_KEY (>= 32 karakter), GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET, EKIPTAKIP_HOST_APP, EKIPTAKIP_HOST_DASHBOARD,
        EKIPTAKIP_COOKIE_DOMAIN. systemd EnvironmentFile: burada olan
        degisken modulun kendi degerini EZER — DATABASE_URL koyma.
      '';
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8000;
      description = "Yalniz 127.0.0.1'de dinler (EKIPTAKIP_BIND); disariya yalniz nginx bakar.";
    };

    mediaDir = lib.mkOption {
      type = lib.types.path;
      default = "/var/lib/ekiptakip/media";
      description = "Yuklenen ekler. Ayri diske koyuyorsan yolu ver; servis o mount olmadan baslamaz.";
    };
  };

  config = lib.mkIf cfg.enable {
    users.users.ekiptakip = { isSystemUser = true; group = "ekiptakip"; };
    users.groups.ekiptakip = { };

    # ensureDBOwnership: rol + veritabani ayni ad. Sema gocu pgcrypto ve
    # unaccent olusturuyor — ikisi de "trusted", DB sahibi olusturabilir.
    services.postgresql = {
      enable = true;
      ensureDatabases = [ "ekiptakip" ];
      ensureUsers = [{ name = "ekiptakip"; ensureDBOwnership = true; }];
    };

    systemd.services.ekiptakip = {
      description = "EkipTakip (Rust)";
      wantedBy = [ "multi-user.target" ];
      # postgresql.target: servis + ensureDatabases/ensureUsers BITTIKTEN sonra.
      after = [ "postgresql.target" "network-online.target" ];
      requires = [ "postgresql.target" ];
      wants = [ "network-online.target" ];

      # Paket yolu her surumde degisir; birim de o zaman yeniden baslar.
      restartTriggers = [ cfg.package ];

      # Disk yoksa servis ACILMAZ (nofail mount'un sessiz SD-kart dolumunu
      # onler; ~/nix KNOW-248). Ayri diske koymayan icin zararsiz.
      unitConfig.RequiresMountsFor = cfg.mediaDir;

      environment = {
        # Yayin modu ACIK verilir: sahte kimlik ve zayif anahtar acilista
        # reddedilir (config.rs). Hostlara bakip tahmin etmesine birakma.
        EKIPTAKIP_ENV = "yayin";
        EKIPTAKIP_BIND = "127.0.0.1";
        PORT = toString cfg.port;
        EKIPTAKIP_MEDIA_ROOT = toString cfg.mediaDir;
        # `postgresql://ekiptakip@/...` YAZMA: bos host + kullanici bilgisi
        # sqlx'te `Configuration(EmptyHost)` ile acilista patliyor. Kullanici
        # sorgu parametresi olarak verilir.
        DATABASE_URL = "postgresql:///ekiptakip?host=/run/postgresql&user=ekiptakip";
      };

      serviceConfig = {
        User = "ekiptakip";
        Group = "ekiptakip";
        EnvironmentFile = cfg.environmentFile;
        ExecStart = lib.getExe cfg.package;

        # "+" = root olarak, User'dan bagimsiz. Mount RequiresMountsFor ile
        # zaten hazir; sahiplik her acilista kendini onarir. Yalniz kok:
        # altindakileri uygulama yazdi, gezmenin anlami yok.
        ExecStartPre = [
          "+${pkgs.coreutils}/bin/mkdir -p ${cfg.mediaDir}"
          "+${pkgs.coreutils}/bin/chown ekiptakip:ekiptakip ${cfg.mediaDir}"
        ];

        Restart = "on-failure";
        RestartSec = "3s";

        NoNewPrivileges = true;
        PrivateTmp = true;
        ProtectHome = true;
        ProtectSystem = "full";
      };
    };
  };
}
