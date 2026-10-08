# 77 — Gerçek zamanlı kanal (WebSocket)

Kod: `backend/src/realtime.rs`, `frontend/src/api/realtime.ts`, olay→sorgu eşlemesi
`frontend/src/api/hooks.ts` (`onRealtimeEvent`).

## Kural: olay veri taşımaz

Soket ikinci bir okuma yolu değil, önbelleği geçersiz kılan bir zildir. Olay yalnız
"şu kimlik değişti" der; istemci veriyi yine REST'ten çeker ve yetki orada denetlenir.
Sonuç: yeni uç eklemek yeni şema gerektirmez, bir olayın sızdırabileceği tek şey bir
kimliğin değiştiğidir.

## Uç ve konular

`GET /api/ws`, sekme başına tek soket. Oturum çerezi + `Origin == Host` (yabancı Origin
403 `bad_origin`; Origin'siz istek tarayıcı değildir, geçer). İstemci → sunucu:
`{"op":"sub"|"unsub","topic":"record:<uuid>"|"chat:<uuid>"}`.

| Konu | Kim abone olabilir | Olay |
|---|---|---|
| `All` | herkes, otomatik (istemci yazamaz) | `{"t":"lists"}` — kayıt listeleri, ana sayfa, eylemlerim, gelen kutusu, bildirimler |
| `record:<id>` | giriş yapmış herkes (kayıtlar herkese açık okunur) | `{"t":"record","id"}` — alan, eylem, kart, katılım; akış da etkilenir |
| `chat:<id>` | akış ucuyla AYNI kural (`chats::authorize_read`, gizli kayıt) | `{"t":"chat","id"}` |

Konu sayısı bağlantı başına 64. `lists` kimlik taşımaz, herkese gider.

## Yazma olayları ara katmanda

Başarılı (2xx) her değiştiren istek, URL'sinden hedefe çevrilir (`realtime::target`).
Handler'a satır eklemek unutulabilir; ara katman unutulmaz. CSRF kapısının İÇİNDE
olduğu için reddedilen (403) ya da çakışan (409) istek olay üretmez. Sabitleme ve kart
sırası kişisel tercih: olay yok. Yeni bir yazma ucu `/api/records/{id}/…`,
`/api/cards/{id}`, `/api/actions/{id}`, `/api/chats/{id}/messages` altındaysa kendiliğinden
kapsanır; başka bir yola konuyorsa `target()` ve birim testi güncellenir.

**Kapsam dışı (sonraki adımlar):** etkinlik planlama uçları, düğüm ağacı, yönetim
(yetki değişimi), kilitler/varlık. Bunlar şimdilik eski yoklamayla/odak tazelemesiyle
güncellenir.

## Dayanıklılık

- **Yavaş istemci:** bağlantı başına 64'lük kuyruk; dolarsa bağlantı düşürülür. İstemci
  yeniden bağlanır ve açık sorguların hepsini tazeler — kaçırılan olay için tekrar
  oynatma tamponu yok, bu telafi yeter.
- **Kopma:** istemci üstel bekleme + rastgelelikle (1→30 sn) yeniden bağlanır; yeniden
  bağlanınca `invalidateQueries()` (ilk açılışta değil).
- **Canlılık:** sunucu 25 sn'de bir ping atar, 75 sn hiçbir çerçeve gelmezse kapatır
  (Cloudflare tüneli boşta bağlantıyı ~100 sn'de keser).
- **Yedek yoklama:** soket kapalıyken sohbet 15 sn, gelen kutusu 30 sn, bildirimler 60 sn
  yoklar (eski davranış). Soket açıkken olaylar tazeler, yoklama yalnız 5 dk'lık yedek.
- Hub süreç belleğinde (tek süreç şartı, KNOW-85). Çok süreçte Postgres `LISTEN/NOTIFY`;
  konu/olay biçimi değişmez.

## Yazma çakışması (aynı değişikliğin parçası)

`PATCH /api/records/{id}` isteğe bağlı `base` alır: istemcinin GÖRDÜĞÜ değer. Alan o arada
değiştiyse 409 `stale_field`; sessiz "son yazan kazanır" yok. Kontrol alan başınadır
(farklı alanlar takılmaz), `base: null` geçerlidir, `base` yoksa kontrol yoktur. Satır
işlemde kilitlenir (`for update`); günlüğe yazılan eski değer de oradan gelir. Hedef değer
zaten oradaysa no-op. `usePatchRecord` `base`'i önbellekteki kayıttan kendisi ekler.

## Dağıtım

nginx `/api/ws` için Upgrade başlıklarını geçirmeli (nginx yapılandırması `~/nix`'te,
bu depoda değil):

```nginx
location = /api/ws {
    proxy_pass http://127.0.0.1:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;       # Origin == Host denetimi buna dayanır
    proxy_read_timeout 3600s;          # sunucu 25 sn'de bir ping atar
}
```

NixOS'ta `services.nginx.virtualHosts.<ad>.locations."/api/ws".proxyWebsockets = true`
(Host başlığı varsayılan olarak geçer). Cloudflare tüneli WebSocket'i ayrıca bir ayar
istemez. **nginx güncellenmeden yayına alınırsa uygulama bozulmaz:** yükseltme başarısız
olur, istemci geri çekilmeyle yeniden dener ve eski yoklama çalışmaya devam eder.
Geliştirmede Vite vekili `ws: true` (vite.config.ts).
