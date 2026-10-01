# Nix tarafına devir — medya ekleri

Bu dosya `~/nix` (github:Efe0909/nix) deposunda yapılması gereken değişiklikleri
sıralar. Buradaki iş **bu depoda yapılamaz**: uygulama deposu ile makine
yapılandırması ayrı depolar, ve bu daldaki ajanın `~/nix`'e yazma yetkisi yok.

Sıra önemli: 1. madde yapılmadan özellik **test edilemez**.

---

## 1. ⛔ ÖNCE BU — `client_max_body_size` 2m → 12m

**Dosya:** `modules/nginx/ekiptakip.nix`, `proxyBasliklari` bloğu.

```nix
    client_max_body_size 2m;      # ← BUGÜNKÜ HÂLİ
    client_max_body_size 12m;     # ← OLMASI GEREKEN
```

**Neden bloklayıcı:** yükleme sınırı uygulamada 10 MB. nginx 2 MB'ta kesiyor ve
bunu **isteği uygulamaya hiç iletmeden** yapıyor — yani:

- 2 MB üstü her yükleme çıplak bir nginx 413 sayfası alır,
- `journalctl -u ekiptakip` içinde **hiçbir iz kalmaz**,
- uygulamanın Türkçe hata mesajı hiç görünmez.

Telefondan çekilen bir fotoğraf tipik olarak 3–8 MB. Yani bu satır
değişmeden **özelliğin çalıştığı hiç görülemez**; "yükleme bozuk" sanılır.

12m tesadüfi değil: 10 MB dosya + multipart çerçeve payı, üstüne uygulamanın
kendi erken-reddetme eşiğinin (~11 MB) biraz üstünde kalacak bir marj. Böylece
sınırı aşan isteklerin çoğu nginx'ten değil **uygulamadan** dönen anlaşılır
Türkçe hatayı alır.

> Aynı tuzak bu deponun kendi nginx şablonlarında da vardı
> (`deploy/nginx-ekiptakip*-ortak.conf`); orada düzeltildi. `~/nix` ayrı bir
> depo olduğu için oradaki kopya **elle** güncellenmeli.

## 2. Modülü içe aktar

`deploy/nix-ekiptakip-media.nix` (bu depoda) `~/nix/modules/` altına
kopyalanır ve `flake.nix`'teki modül listesine eklenir:

```nix
  modules = [
    # ...
    ./modules/ekiptakip-app.nix
    ./modules/ekiptakip-media.nix      # ← eklenen satır
  ];
```

Modül `ekiptakip-app.nix`'e **dokunmuyor**; aynı systemd biriminin farklı
alanlarını tamamlıyor (NixOS modül sistemi buna izin verir, yeter ki iki
modül aynı yaprak anahtara yazmasın). Getirdikleri:

- `systemd.tmpfiles.rules` — `/home/efe/sata/ekiptakip/media`, sahibi
  `10001:10001` (konteynerdeki `ekiptakip` kullanıcısının **sayısal** uid'i;
  konteynerde o uid'e karşılık gelen bir `/etc/passwd` kaydı yok, o yüzden
  eşleşme isimle değil sayıyla kurulur).
- `systemd.services.ekiptakip.environment.EKIPTAKIP_MEDIA_DIR` — compose
  dosyasındaki `${EKIPTAKIP_MEDIA_DIR:-./var/media}` yerine koymasını besler.
- `unitConfig.RequiresMountsFor` — aşağıda, 3. maddede.

## 3. Test VM'inde virtio diski `sata` etiketiyle bağla

`modules/configuration.nix` diski **etiketle** bağlıyor:

```nix
  fileSystems."/home/efe/sata".device = "/dev/disk/by-label/sata";
```

Yani VM'e takılan virtio diskin dosya sistemine `sata` etiketi verilirse,
**gerçek Pi ile aynı yola** oturur ve uygulama hangi makinede olduğunu
bilmek zorunda kalmaz:

```bash
sudo mkfs.ext4 -L sata /dev/vdb      # DİKKAT: diski siler
sudo systemctl daemon-reload && sudo mount -a
findmnt /home/efe/sata               # doğrula
```

### `RequiresMountsFor` neden var

SATA bağlantısı `nofail` — bu **bilerek** öyle (2026-08-30'da bu satırın
yokluğu makineyi açılamaz hâle getirmişti, o karar değişmiyor). Ama `nofail`'in
bedeli şu: disk yoksa systemd mount'u sessizce atlar ve `/home/efe/sata`
kök dosya sisteminde (SD kart) sıradan boş bir dizin olarak kalır. tmpfiles
kuralı o durumda da çalışır, medya dizinini **SD kartta** oluşturur, uygulama
yazılabilir bir dizin görür ve mutlu mutlu oraya yazar. Sonuç: medya sessizce
SD karta birikir, disk takılana kadar kimse fark etmez.

`RequiresMountsFor = "/home/efe/sata"` bunu sertleştirir: mount başarılı
olmadan servis başlamaz. İkisi çelişmiyor — makine disksiz de **açılır**
(`nofail`), ama ekiptakip disksiz **açılmaz**. Belirti görünür bir
`systemctl --failed` olur, sessiz bir kart dolumu değil.

## 4. (İsteğe bağlı) X-Accel-Redirect — nginx dosyayı doğrudan versin

Varsayılan **kapalı**; uygulama `FileResponse` ile servis eder ve bu doğru
çalışır. Açmanın sebebi başarım: `--workers 1` zorunlu (ağaç indeksi süreç
belleğinde), yani her görsel baytı sayfaları da üreten **tek** süreci meşgul
eder.

Açmak iki parça ister:

**(a) nginx medya dizinini görebilmeli.** `/home/efe` modu 0700 — nginx
oraya *giremez*, medya dizinini ne kadar açarsan aç. Ev dizinini gevşetmek
yerine bind mount:

```nix
  fileSystems."/srv/ekiptakip/media" = {
    device = "/home/efe/sata/ekiptakip/media";
    options = [ "bind" "nofail" ];
  };
```

**(b) `internal` location + uygulamaya değişken.**

```nix
  locations."/_media/" = {
    alias = "/srv/ekiptakip/media/";
    extraConfig = ''
      internal;                     # ← TAŞIYICI SATIR, silme
      open_file_cache max=1000 inactive=60s;
    '';
  };
```

ve serviste `EKIPTAKIP_MEDIA_ACCEL = "/_media";`.

> `internal;` **taşıyıcı**: o satır olmadan `/_media/...` dışarıdan doğrudan
> istenebilir ve kimlik kapısı (LoginGate) tamamen atlanır.

### ⛔ `proxy_cache` EKLEME

`/media/` üzerinde paylaşımlı bir nginx önbelleği, baytları **uygulamaya
sormadan** verir — yani oturumsuz bir `GET /media/{uuid}` önbellekten yanıt
alır. Tahmin edilemeyen UUID bir erişim denetimi değildir. `X-Accel-Redirect`
tam da bunu çözüyor: yetki her istekte uygulamada kalır, yalnızca baytlar
nginx'e geçer.

## 5. (İsteğe bağlı) Samba — yalnızca okuma

`deploy/nix-ekiptakip-media.nix` içinde **yorum olarak** hazır duruyor.
Açmadan önce iki kural:

1. Yalnızca **medya dizinini** paylaş, `/home/efe/sata`'nın tamamını değil —
   o diskte restic yedekleri de var, onları ağda gezilebilir yapmanın faydası
   yok, riski var.
2. `"read only" = "yes"` **şart**. Bu baytların tek sahibi ekiptakip
   konteyneri; SMB'den yazma açarsan iki yazar aynı dosyalara farklı
   yollardan dokunur ve veritabanındaki `storage_key`/`thumb_key`
   varsayımları bir istemci dosyayı taşıdığında/sildiğinde sessizce bozulur.

`configuration.nix` zaten kendi yorumlarında bunu öngörüyor (avahi: "samba
ile birlikte açılır"; firewall: "Samba açılırsa: … 139 445").

---

## ⚠️ Kapanmamış konu: medya hiçbir şey tarafından yedeklenmiyor

`services.restic.backups.yerel` (configuration.nix) `/var/lib`, `/home/efe` ve
`/etc/nixos` yedekliyor — ama `/home/efe/sata`'yı **hariç tutuyor** (kendini
yedeklemesin diye, haklı olarak). Medya artık
`/home/efe/sata/ekiptakip/media` altında olduğuna göre:

**bugün ek dosyalarını yedekleyen hiçbir mekanizma yok.**

Disk arızası her görseli kalıcı olarak götürür — üstelik Postgres yedekleri
o dosyalara işaret eden satırları sağlam tutmaya devam eder, yani veritabanı
var olmayan dosyaları gösterir. Bu bir tasarım açığı, bir hata değil: 3-2-1
için zaten "üçüncü bir hedef" gerektiği `configuration.nix` yorumlarında
yazılı. Karar senin; burada yalnızca **görünür** kılıyoruz.

Seçenekler, ucuzdan pahalıya: (a) medyayı restic'in `paths` listesine ayrıca
ekle (aynı disk — disk arızasına karşı korumaz, kazara silmeye karşı korur);
(b) harici bir diske ikinci bir restic hedefi; (c) uzak sunucu.
