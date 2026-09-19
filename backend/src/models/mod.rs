//! Satir tipleri. Tablo basina bir struct SART DEGIL — ham SQL`de her sorgu
//! kendi tipini dondurur ve `chat_feed` view`inin satiri hicbir tablonun
//! karsiligi degil. Sorguya ozel tipler onlari kullanan handler`in yaninda
//! durabilir; burasi paylasilanlar icin.

pub mod action;
pub mod activity;
pub mod attachment;
pub mod card;
pub mod item;
pub mod message;
pub mod node;
pub mod team;
pub mod user;
