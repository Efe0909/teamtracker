//! Sabit pencereli hiz siniri — anahtar basina (IP) `limit` istek / `window`.
//!
//! Python'daki `_gecmis` sozlugu hic bosaltilmiyordu (KNOW-68). Burada sozluk
//! `MAX_KEYS`'i asinca suresi dolmus kovalar atilir.
//!
//! ponytail: surec ici, tek surec varsayimi (KNOW-85 zaten sart). Yatay
//! olcekte paylasilan bir depo (Postgres/Redis) gerekir.

use std::{collections::HashMap, sync::Mutex, time::{Duration, Instant}};

const MAX_KEYS: usize = 10_000;

pub struct RateLimit {
    limit: u32,
    window: Duration,
    buckets: Mutex<HashMap<String, (Instant, u32)>>,
}

impl RateLimit {
    pub fn new(limit: u32, window: Duration) -> Self {
        RateLimit { limit, window, buckets: Mutex::new(HashMap::new()) }
    }

    /// Istek sayilir; sinir asildiysa `false`.
    pub fn allow(&self, key: &str) -> bool {
        let now = Instant::now();
        // Zehirli kilit yalniz sayac kaybettirir; kurtarmak guvenli.
        let mut b = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        if b.len() >= MAX_KEYS {
            let window = self.window;
            b.retain(|_, (start, _)| now.duration_since(*start) < window);
        }
        let entry = b.entry(key.to_string()).or_insert((now, 0));
        if now.duration_since(entry.0) >= self.window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= self.limit
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blocks_after_limit_and_resets_after_window() {
        let rl = RateLimit::new(2, Duration::from_millis(50));
        assert!(rl.allow("a"));
        assert!(rl.allow("a"));
        assert!(!rl.allow("a"));
        assert!(rl.allow("b"), "kovalar anahtar basina");
        std::thread::sleep(Duration::from_millis(60));
        assert!(rl.allow("a"), "pencere dolunca sifirlanir");
    }
}
