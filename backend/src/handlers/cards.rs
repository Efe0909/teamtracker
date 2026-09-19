//! Kart yazma. Bozuk blob = serde hatasi -> CardBody::Broken, SAKLANMAZ,
//! her cizimde hesaplanir (KNOW-280). Yetki ASLA blob okumaz.
//! Katilim blob`da; jsonb_set ile TEK ifade — SELECT-degistir-UPDATE yaris
//! yaratir (KNOW-281).
