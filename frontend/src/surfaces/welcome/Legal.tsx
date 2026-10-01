import "./welcome.css";
import { Brand, Foot } from "./Welcome";

// Girissiz yasal sayfalar (apex). Google OAuth marka dogrulamasi ana sayfayla
// AYNI alan adinda gizlilik politikasi ister; konsoldaki linkler bunlar.
// Metin koda bakilarak yazildi: Google'dan yalniz `sub` + e-posta saklanir
// (backend/src/api/auth.rs callback). Yeni veri toplanirsa burasi da degisir.

export type LegalPage = "privacy" | "terms";

export function Legal({ page }: { page: LegalPage }) {
  return (
    <div className="welcome">
      <header className="topbar">
        <a href="/welcome" className="brand-link">
          <Brand />
        </a>
      </header>
      <main className="legal">{page === "privacy" ? <Privacy /> : <Terms />}</main>
      <Foot />
    </div>
  );
}

function Privacy() {
  return (
    <article aria-labelledby="legal-title">
      <h1 id="legal-title">Gizlilik politikası</h1>
      <p className="muted">Son güncelleme: 1 Ekim 2026</p>

      <p>
        EkipTakip, davetli ekip üyelerinin iş kayıtlarını, eylemlerini ve kart içi sohbetlerini tuttuğu bir iş
        takip uygulamasıdır. Bu sayfa hangi veriyi neden tuttuğumuzu anlatır.
      </p>

      <h2>Google hesabından aldıklarımız</h2>
      <p>
        "Google ile devam et" yalnızca <code>openid email profile</code> izinlerini ister. Bunlardan yalnızca
        şunları saklarız:
      </p>
      <ul>
        <li>
          <strong>E-posta adresin</strong> — davetli listesinde olup olmadığını kontrol etmek ve sana bildirim
          göndermek için.
        </li>
        <li>
          <strong>Google hesap kimliğin</strong> (<code>sub</code>) — e-postan değişse de hesabını tanımak için.
        </li>
      </ul>
      <p>
        Adın ve profil fotoğrafın Google'dan alınmaz; ekipteki adını yöneticin girer. Takvim, Drive, Gmail gibi
        başka hiçbir Google verisine erişmeyiz.
      </p>
      <p>
        Google API'lerinden alınan bilgilerin kullanımı ve başka uygulamalara aktarımı,{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>{" "}
        ve buradaki Limited Use şartlarına uyar.
      </p>

      <h2>Uygulamada oluşan veriler</h2>
      <ul>
        <li>Girdiğin kayıtlar, eylemler, sohbet mesajları ve yüklediğin ekler.</li>
        <li>Bildirim ayarların ve, açtıysan, tarayıcının push aboneliği.</li>
        <li>
          Güvenlik kaydı: giriş denemeleri ve yetki hataları için IP adresi, e-posta ve zaman. Kötüye kullanımı
          görmek ve giriş hız sınırı için tutulur.
        </li>
      </ul>

      <h2>Çerezler</h2>
      <p>
        Yalnızca oturumunu açık tutan imzalı bir çerez ve form güvenliği (CSRF) için bir belirteç kullanırız.
        Reklam ya da izleme çerezi yoktur.
      </p>

      <h2>Kimlerle paylaşılır</h2>
      <p>Verin satılmaz, reklam için kullanılmaz. Yalnızca hizmeti çalıştırmak için şu aracılardan geçer:</p>
      <ul>
        <li>Cloudflare — siteye gelen trafiği sunucumuza taşır.</li>
        <li>Resend — e-posta bildirimlerini iletir (alıcı adresi ve mesaj).</li>
        <li>Tarayıcının push servisi (Apple, Google ya da Mozilla) — telefon bildirimlerini iletir.</li>
      </ul>
      <p>Uygulama ekibin dışındaki kimseye açık değildir; içerikleri yalnız yetkili ekip üyeleri görür.</p>

      <h2>Saklama ve silme</h2>
      <p>
        Veriler hesabın açık olduğu sürece tutulur. Hesabının kapatılmasını ya da verilerinin silinmesini
        ekibinin yöneticisinden isteyebilirsin. Google hesabının bu uygulamaya erişimini istediğin an{" "}
        <a href="https://myaccount.google.com/permissions">Google hesap izinleri</a> sayfasından kaldırabilirsin.
      </p>

      <h2>Değişiklikler</h2>
      <p>Bu politika değişirse güncel hali bu adreste yayınlanır ve tarih yukarıda güncellenir.</p>
    </article>
  );
}

function Terms() {
  return (
    <article aria-labelledby="legal-title">
      <h1 id="legal-title">Kullanım koşulları</h1>
      <p className="muted">Son güncelleme: 1 Ekim 2026</p>

      <p>EkipTakip'i kullanarak aşağıdaki koşulları kabul etmiş olursun.</p>

      <h2>Kimler kullanabilir</h2>
      <p>
        Uygulama yalnızca davet edilmiş ekip üyeleri içindir. Davetli listesinde olmayan hesaplar giriş yapamaz.
        Hesabını başkasıyla paylaşma.
      </p>

      <h2>Kullanım</h2>
      <ul>
        <li>Uygulamayı yalnızca ekibin işi için kullan.</li>
        <li>Başkalarının haklarını ihlal eden, yasa dışı ya da zararlı içerik yükleme.</li>
        <li>Güvenlik önlemlerini aşmaya, başkasının hesabına girmeye ya da hizmeti aksatmaya çalışma.</li>
      </ul>

      <h2>İçerik</h2>
      <p>
        Girdiğin içerik sana ve ekibine aittir. Uygulama bu içeriği yalnızca hizmeti sunmak için işler; nasıl
        işlendiği <a href="/privacy">gizlilik politikasında</a> anlatılır.
      </p>

      <h2>Hesabın kapatılması</h2>
      <p>Bu koşullara uymayan hesaplar yönetici tarafından kapatılabilir.</p>

      <h2>Sorumluluk</h2>
      <p>
        Uygulama geliştirme aşamasındadır (alpha) ve "olduğu gibi" sunulur. Kesintisiz ya da hatasız
        çalışacağı garanti edilmez; önemli verilerinin ayrıca bir kopyasını tut.
      </p>

      <h2>Değişiklikler</h2>
      <p>Koşullar değişirse güncel hali bu adreste yayınlanır ve tarih yukarıda güncellenir.</p>
    </article>
  );
}
