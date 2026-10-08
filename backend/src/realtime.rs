//! Gercek zamanli kanal: sekme basina TEK WebSocket (`GET /api/ws`).
//!
//! KURAL: olay VERI tasimaz, yalniz "su degisti" der (kimlik). Istemci veriyi
//! yine REST'ten ceker; yetki orada denetlenir. Yani soket ikinci bir okuma
//! yolu degil, onbellegi gecersiz kilan bir zil: yeni uc = yeni sema yok, ve
//! bir olayin sizdirabilecegi tek sey "bu kimlik degisti".
//!
//! Konular (`Topic`):
//!   All          — herkes otomatik; kimliksiz "listeler degisti" (`Event::Lists`)
//!   Record(id)   — acik kayit; kayitlar herkese acik okundugu icin serbest
//!   Chat(id)     — sohbet; `chats::authorize_read` ile AYNI kural (gizli kayit)
//!
//! YAZMA OLAYLARI ara katmanda (`publish_writes`): basarili her degistiren
//! istek URL'sinden hedefe cevrilir. Handler'a tek satir eklemek unutulabilir,
//! ara katman unutulmaz; CSRF kapisinin ICINDE oldugu icin reddedilen istek
//! olay uretmez. Handler donduyse islem zaten commit'li.
//!
//! TEK SUREC (KNOW-85): hub surec bellekte, `presence` gibi. Yatay olceklenirse
//! burasi Postgres LISTEN/NOTIFY'a baglanir; konu/olay bicimi ayni kalir.
//!
//! YAVAS ISTEMCI: baglanti basina sinirli kuyruk. Dolarsa baglanti DUSURULUR —
//! istemci yeniden baglanir ve her seyi tazeler; bu zaten kacirilan olay
//! icin dogru telafi (tekrar oynatma tamponu gerekmez).

use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Request, State,
    },
    http::{header, HeaderMap, Method},
    middleware::Next,
    response::Response,
};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::{
    api::authorize_chat_read,
    auth::CurrentUser,
    error::{AppError, Result},
    models::user::User,
    state::AppState,
};

/// Baglanti basina bekleyen olay siniri; asilirsa baglanti dusurulur.
const QUEUE: usize = 64;
/// Bir baglantinin abone olabilecegi konu sayisi (kotuye kullanima karsi).
const MAX_TOPICS: usize = 64;
/// Sunucu bu aralikla ping atar (Cloudflare bosta baglantiyi ~100 sn'de keser).
const PING_EVERY: Duration = Duration::from_secs(25);
/// Bu sure hicbir cerce (pong dahil) gelmezse baglanti olu sayilir.
const DEAD_AFTER: Duration = Duration::from_secs(75);
/// Istemciden gelen en buyuk cerce: abonelik mesajlari kucuktur.
const MAX_MESSAGE: usize = 1024;

#[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
pub enum Topic {
    All,
    Record(Uuid),
    Chat(Uuid),
}

impl Topic {
    /// Istemcinin isteyebilecegi konular: `record:<uuid>` ve `chat:<uuid>`.
    /// `All` sunucuya aittir, istemci adini yazamaz.
    fn parse(s: &str) -> Option<Topic> {
        let (kind, id) = s.split_once(':')?;
        let id = Uuid::parse_str(id).ok()?;
        match kind {
            "record" => Some(Topic::Record(id)),
            "chat" => Some(Topic::Chat(id)),
            _ => None,
        }
    }
}

/// Telde giden olay. `t` ayirt edici; on yuz `api/realtime.ts` ile ayni bicim.
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "t", rename_all = "snake_case")]
pub enum Event {
    /// Bir kayit degisti (alan, eylem, kart, katilim...). Akis da etkilenir.
    Record { id: Uuid },
    /// Bir sohbete mesaj geldi.
    Chat { id: Uuid },
    /// Kayit listeleri, ana sayfa, eylemlerim degisti. Kimlik yok: herkese gider.
    Lists,
}

struct Conn {
    tx: mpsc::Sender<Arc<str>>,
    topics: HashSet<Topic>,
}

#[derive(Default)]
struct Inner {
    next: u64,
    conns: HashMap<u64, Conn>,
}

#[derive(Default)]
pub struct Hub {
    inner: Mutex<Inner>,
}

impl Hub {
    /// Kilit ASLA await boyunca tutulmaz (std Mutex: derlenmez bile).
    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    pub fn register(&self) -> (u64, mpsc::Receiver<Arc<str>>) {
        let (tx, rx) = mpsc::channel(QUEUE);
        let mut g = self.lock();
        g.next += 1;
        let id = g.next;
        g.conns.insert(id, Conn { tx, topics: HashSet::from([Topic::All]) });
        (id, rx)
    }

    pub fn unregister(&self, id: u64) {
        self.lock().conns.remove(&id);
    }

    /// `false`: baglanti yok ya da konu sinirina ulasti.
    pub fn subscribe(&self, id: u64, topic: Topic) -> bool {
        match self.lock().conns.get_mut(&id) {
            Some(c) if c.topics.len() < MAX_TOPICS => {
                c.topics.insert(topic);
                true
            }
            _ => false,
        }
    }

    pub fn unsubscribe(&self, id: u64, topic: Topic) {
        if let Some(c) = self.lock().conns.get_mut(&id) {
            c.topics.remove(&topic);
        }
    }

    /// Konuya abone herkese gonderir. Kuyrugu dolan ya da kapanan baglanti
    /// kayittan dusurulur (bkz. modul notu "YAVAS ISTEMCI").
    pub fn publish(&self, topic: Topic, event: &Event) {
        let Ok(msg) = serde_json::to_string(event) else { return };
        let msg: Arc<str> = msg.into();
        self.lock().conns.retain(|_, c| !c.topics.contains(&topic) || c.tx.try_send(msg.clone()).is_ok());
    }

    #[cfg(test)]
    fn connections(&self) -> usize {
        self.lock().conns.len()
    }
}

// --- yazma olaylari (ara katman) -------------------------------------------

/// Degistiren istegin neyi degistirdigi, YALNIZ yoldan.
#[derive(Debug, PartialEq)]
enum Target {
    Record(Uuid),
    /// Kart/eylem: kayit kimligi yolda yok, veritabanindan bulunur.
    Card(Uuid),
    Action(Uuid),
    Chat(Uuid),
    Lists,
}

fn target(path: &str) -> Option<Target> {
    let seg: Vec<&str> = path.strip_prefix("/api/")?.split('/').collect();
    let id = |s: &&str| Uuid::parse_str(s).ok();
    match seg.as_slice() {
        ["records"] => Some(Target::Lists),
        // Sabitleme ve kart sirasi KISISEL tercih: baskasini ilgilendirmez.
        ["records", _, "pin" | "card-order"] => None,
        ["records", rid, ..] => id(rid).map(Target::Record),
        ["cards", cid, ..] => id(cid).map(Target::Card),
        ["actions", aid] => id(aid).map(Target::Action),
        ["chats", cid, "messages"] => id(cid).map(Target::Chat),
        _ => None,
    }
}

async fn record_of_card(st: &AppState, id: Uuid) -> Option<Uuid> {
    sqlx::query_scalar("select record_id from cards where id = $1")
        .bind(id).fetch_optional(&st.pool).await.ok().flatten()
}

async fn record_of_action(st: &AppState, id: Uuid) -> Option<Uuid> {
    sqlx::query_scalar("select record_id from actions where id = $1")
        .bind(id).fetch_optional(&st.pool).await.ok().flatten()
}

pub async fn publish_writes(State(st): State<AppState>, req: Request, next: Next) -> Response {
    if matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS) {
        return next.run(req).await;
    }
    let target = target(req.uri().path());
    // Kart/eylem silinebilir: kayit kimligini handler'dan ONCE oku.
    let record = match &target {
        Some(Target::Card(id)) => record_of_card(&st, *id).await,
        Some(Target::Action(id)) => record_of_action(&st, *id).await,
        Some(Target::Record(id)) => Some(*id),
        _ => None,
    };
    let res = next.run(req).await;
    if !res.status().is_success() {
        return res;
    }
    match (target, record) {
        (Some(Target::Chat(id)), _) => {
            st.hub.publish(Topic::Chat(id), &Event::Chat { id });
            st.hub.publish(Topic::All, &Event::Lists);
        }
        (Some(Target::Lists), _) => st.hub.publish(Topic::All, &Event::Lists),
        (Some(_), Some(id)) => {
            st.hub.publish(Topic::Record(id), &Event::Record { id });
            st.hub.publish(Topic::All, &Event::Lists);
        }
        _ => {}
    }
    res
}

// --- soket -----------------------------------------------------------------

/// Tarayici saldirisina (baska sitenin sayfasindan soket acmak) karsi: Origin
/// varsa Host ile AYNI olmali. Origin'siz istek tarayici degil (curl, test),
/// o saldiri tarayiciya ozgu. Cerez zaten `SameSite=Lax`; bu ikinci katman.
fn same_origin(h: &HeaderMap) -> bool {
    let Some(origin) = h.get(header::ORIGIN) else { return true };
    let origin = origin.to_str().ok().and_then(|o| o.split_once("://")).map(|(_, rest)| rest);
    let host = h.get(header::HOST).and_then(|v| v.to_str().ok());
    matches!((origin, host), (Some(o), Some(h)) if o.eq_ignore_ascii_case(h))
}

pub async fn connect(
    State(st): State<AppState>, CurrentUser(me): CurrentUser, headers: HeaderMap, ws: WebSocketUpgrade,
) -> Result<Response> {
    if !same_origin(&headers) {
        return Err(AppError::Denied("bad_origin"));
    }
    Ok(ws.max_message_size(MAX_MESSAGE).on_upgrade(move |sock| session(st, me, sock)))
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum Op {
    Sub,
    Unsub,
}

#[derive(Deserialize)]
struct ClientMsg {
    op: Op,
    topic: String,
}

async fn may_subscribe(st: &AppState, me: &User, topic: Topic) -> bool {
    match topic {
        // Kayitlar herkese acik okunur (records::get); olay yalniz kimlik tasir.
        Topic::Record(_) => true,
        Topic::Chat(chat) => authorize_chat_read(st, me, chat).await.is_ok(),
        Topic::All => false,
    }
}

async fn on_client(st: &AppState, me: &User, conn: u64, text: &str) {
    let Ok(m) = serde_json::from_str::<ClientMsg>(text) else { return };
    let Some(topic) = Topic::parse(&m.topic) else { return };
    match m.op {
        Op::Unsub => st.hub.unsubscribe(conn, topic),
        Op::Sub => {
            if may_subscribe(st, me, topic).await {
                st.hub.subscribe(conn, topic);
            }
        }
    }
}

async fn session(st: AppState, me: User, mut sock: WebSocket) {
    let (conn, mut rx) = st.hub.register();
    let mut ping = tokio::time::interval(PING_EVERY);
    let mut last_rx = Instant::now();
    loop {
        tokio::select! {
            out = rx.recv() => match out {
                Some(msg) => if sock.send(Message::Text(msg.as_ref().into())).await.is_err() { break },
                // Hub bizi dusurdu (yavas istemci): kapat, istemci yeniden baglanir.
                None => break,
            },
            inc = sock.recv() => match inc {
                Some(Ok(Message::Text(t))) => { last_rx = Instant::now(); on_client(&st, &me, conn, t.as_str()).await }
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                // Pong/Ping/ikili: hayat belirtisi say, baska is yok.
                Some(Ok(_)) => last_rx = Instant::now(),
            },
            _ = ping.tick() => {
                if last_rx.elapsed() > DEAD_AFTER || sock.send(Message::Ping(Vec::new().into())).await.is_err() { break }
            }
        }
    }
    st.hub.unregister(conn);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(n: u8) -> Uuid {
        Uuid::from_bytes([n; 16])
    }

    #[test]
    fn write_paths_map_to_targets() {
        let (r, c) = (id(1), id(2));
        let p = |s: &str| target(&s.replace("{r}", &r.to_string()).replace("{c}", &c.to_string()));
        assert_eq!(p("/api/records"), Some(Target::Lists));
        assert_eq!(p("/api/records/{r}"), Some(Target::Record(r)));
        assert_eq!(p("/api/records/{r}/actions"), Some(Target::Record(r)));
        assert_eq!(p("/api/records/{r}/participants/{c}"), Some(Target::Record(r)));
        assert_eq!(p("/api/records/{r}/cards"), Some(Target::Record(r)));
        assert_eq!(p("/api/cards/{c}"), Some(Target::Card(c)));
        assert_eq!(p("/api/cards/{c}/vote"), Some(Target::Card(c)));
        assert_eq!(p("/api/actions/{c}"), Some(Target::Action(c)));
        assert_eq!(p("/api/chats/{c}/messages"), Some(Target::Chat(c)));
        // Kisisel tercihler ve ilgisiz uclar olay uretmez.
        assert_eq!(p("/api/records/{r}/pin"), None);
        assert_eq!(p("/api/records/{r}/card-order"), None);
        assert_eq!(p("/api/chats/{c}/prefs"), None);
        assert_eq!(p("/api/notifications/seen"), None);
        assert_eq!(p("/api/records/bozuk"), None);
        assert_eq!(p("/api/actions/mine"), None);
    }

    #[test]
    fn clients_can_only_ask_for_record_and_chat_topics() {
        let u = id(7);
        assert_eq!(Topic::parse(&format!("record:{u}")), Some(Topic::Record(u)));
        assert_eq!(Topic::parse(&format!("chat:{u}")), Some(Topic::Chat(u)));
        assert_eq!(Topic::parse("all:x"), None);
        assert_eq!(Topic::parse("record:bozuk"), None);
        assert_eq!(Topic::parse("record"), None);
    }

    #[test]
    fn events_have_a_stable_wire_shape() {
        let u = id(3);
        assert_eq!(serde_json::to_string(&Event::Record { id: u }).unwrap_or_default(),
            format!(r#"{{"t":"record","id":"{u}"}}"#));
        assert_eq!(serde_json::to_string(&Event::Lists).unwrap_or_default(), r#"{"t":"lists"}"#);
    }

    #[tokio::test]
    async fn publish_reaches_only_subscribers() {
        let hub = Hub::default();
        let (a, mut ra) = hub.register();
        let (_b, mut rb) = hub.register();
        let rec = id(1);
        assert!(hub.subscribe(a, Topic::Record(rec)));
        hub.publish(Topic::Record(rec), &Event::Record { id: rec });
        assert!(ra.try_recv().is_ok());
        assert!(rb.try_recv().is_err(), "abone olmayan almaz");
        // Herkes `All`a otomatik abone.
        hub.publish(Topic::All, &Event::Lists);
        assert!(ra.try_recv().is_ok() && rb.try_recv().is_ok());
        hub.unsubscribe(a, Topic::Record(rec));
        hub.publish(Topic::Record(rec), &Event::Record { id: rec });
        assert!(ra.try_recv().is_err());
    }

    #[tokio::test]
    async fn a_slow_client_is_dropped_not_waited_for() {
        let hub = Hub::default();
        let (slow, _rx_never_read) = hub.register();
        let (fast, mut rx_fast) = hub.register();
        for _ in 0..=QUEUE {
            hub.publish(Topic::All, &Event::Lists);
            while rx_fast.try_recv().is_ok() {}
        }
        assert_eq!(hub.connections(), 1, "yavas dusurulur, hizli kalir");
        assert!(!hub.subscribe(slow, Topic::Record(id(1))));
        assert!(hub.subscribe(fast, Topic::Record(id(1))));
    }

    #[test]
    fn topic_count_is_capped() {
        let hub = Hub::default();
        let (c, _rx) = hub.register();
        let accepted = (0..=u8::try_from(MAX_TOPICS).unwrap_or(u8::MAX))
            .filter(|n| hub.subscribe(c, Topic::Record(id(*n)))).count();
        assert_eq!(accepted, MAX_TOPICS - 1, "All da bir konu sayilir");
    }

    #[test]
    fn origin_must_match_host_when_present() {
        let mk = |origin: Option<&str>, host: Option<&str>| {
            let mut h = HeaderMap::new();
            if let Some(o) = origin { h.insert(header::ORIGIN, o.parse().unwrap_or_else(|_| unreachable!())); }
            if let Some(v) = host { h.insert(header::HOST, v.parse().unwrap_or_else(|_| unreachable!())); }
            h
        };
        assert!(same_origin(&mk(None, Some("app.polonyum.com"))), "tarayici disi istemci");
        assert!(same_origin(&mk(Some("https://app.polonyum.com"), Some("app.polonyum.com"))));
        assert!(same_origin(&mk(Some("http://app.localhost:5173"), Some("app.localhost:5173"))));
        assert!(!same_origin(&mk(Some("https://evil.example"), Some("app.polonyum.com"))));
        assert!(!same_origin(&mk(Some("https://app.polonyum.com.evil.example"), Some("app.polonyum.com"))));
        assert!(!same_origin(&mk(Some("null"), Some("app.polonyum.com"))));
        assert!(!same_origin(&mk(Some("https://app.polonyum.com"), None)));
    }
}
