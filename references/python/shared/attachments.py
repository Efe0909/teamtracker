"""Ek sahiplik, izin, etiket katmani (CONTRACT-V2.md §4-5).

shared/media.py yalnizca bayt + goruntu isler — HTTP'den, veritabanindan,
kullanicidan HABERSIZ. shared/service.py olay/mesaj akisini bilir ama
BURADAN itibaren hangi kolonun hangi tabloya yazildigini bilmiyor: sahiplik
GENIS (event/item/node/team, CONTRACT-V2 §1b) ve tek bilen taraf burasi.

CONTRACT-V2 §9: bu dosyanin DISINDA hicbir yer bir ekin bir olaya (event)
bagli oldugunu VARSAYMAZ — owner_id parametresiz, WHERE owner_type='event'
yok. Kart ekler kutusu (item) ya da is semasi (node) baglandiginda tek
degisen taraf CAGIRAN olmali, bu modul degil.

Not (rapora da yazildi): CONTRACT-V2 media.py'ye media.path_in(root, key) ve
media.probe(path) eklenmesini istiyor; bu batch'te media.py degismedi (baska
bir ajanin alani), hala eski path_of(key)/root() imzasinda. Kilitleme mantigi
(_path_in) ve donanim yoklamasi (_probe_mount) burada, media.py'den bagimsiz
olarak yeniden uygulandi.
"""
from __future__ import annotations

import hashlib
import os
import re
import unicodedata
from pathlib import Path

from fastapi import HTTPException

from . import auth, config, db, media

OWNER_TYPES = frozenset({"event", "item", "node", "team", "card"})

# Turkce I/i katlanmasi str.lower()'in varsaydigindan FARKLI: 'İ'.lower()
# Python'da tek 'i' degil 'i' + birlesik nokta (iki karakter) verir; 'ı' zaten
# kucuk ama 'i' ile ayni harf DEGIL. Slug'da dorduyle de AYNI 'i' istiyoruz ki
# 'İstanbul', 'Istanbul', 'istanbul', 'ıstanbul' tek etiket sayilsin — bu
# yuzden dordu, genel katlamadan ONCE, ACIKCA eslenir (CONTRACT-V2 §2, §3).
_TURKISH_I_MAP = str.maketrans({"İ": "i", "I": "i", "ı": "i", "i": "i"})


# --- etiket slug'i (CONTRACT-V2 §2-3) --------------------------------------


def slugify(name: str) -> str:
    """Etiket adini slug'a katlar: unaccent-esdegeri fold + kucultme +
    bosluklarin '-' ile birlestirilmesi. Tekillik slug uzerinde kurulu
    (goc 010), name kullanicinin yazdigi bicimi oldugu gibi tasir.
    """
    folded = (name or "").translate(_TURKISH_I_MAP)
    # unaccent-esdegeri: NFKD ayristirir (ö -> o + birlesik iki nokta), sonra
    # birlesik isaretler (kategori Mn) atilir. Bazi Turkce harfler (orn. ğ)
    # NFKD ayristirmasi tanimlamayabilir — onlar asagidaki ascii-disi filtreyle
    # '-' olur; ustteki ceviri sadece I/İ/ı/i icin GARANTI.
    decomposed = unicodedata.normalize("NFKD", folded)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    collapsed = re.sub(r"[^a-z0-9]+", "-", stripped.lower()).strip("-")
    return collapsed or "etiket"


# --- depolama birimi: donanim cevabi (CONTRACT-V2 §1a, §4) -----------------


def _default_label() -> str:
    """Tek-birimli (bugunku) kurulumun etiketi. Coklu birim tools/media_gc.py
    ve elle yonetim icindir; sync_volume/active_volume yalnizca BU birimi
    otomatik yonetir."""
    return "default"


def _probe_mount(path: Path) -> dict:
    """En iyi eforla dosya sisteminin donanim bilgisini yoklar (CONTRACT-V2
    §4'un media.probe() tarifiyle AYNI yontem — /proc/mounts, os.stat().st_dev
    — burada, media.py bu batch'te degismedigi icin).

    HICBIR ZAMAN raise etmez; bulamadigi alan None kalir.
    """
    result = {"device": None, "fs_uuid": None, "fs_type": None}
    try:
        target = str(path.resolve())
        target_dev = os.stat(target).st_dev
    except OSError:
        return result

    best = None
    try:
        with open("/proc/mounts", "r", encoding="utf-8", errors="replace") as f:
            for line in f:
                parts = line.split()
                if len(parts) < 3:
                    continue
                device, mount_point, fs_type = parts[0], parts[1], parts[2]
                try:
                    if os.stat(mount_point).st_dev != target_dev:
                        continue
                except OSError:
                    continue
                # Ic ice mount'larda EN UZUN eslesen mount noktasi dogru olandir.
                if best is None or len(mount_point) > len(best[1]):
                    best = (device, mount_point, fs_type)
    except OSError:
        pass
    if best is None:
        return result
    result["device"], _, result["fs_type"] = best
    try:
        by_uuid = Path("/dev/disk/by-uuid")
        if by_uuid.is_dir():
            for link in by_uuid.iterdir():
                try:
                    if link.resolve() == Path(result["device"]).resolve():
                        result["fs_uuid"] = link.name
                        break
                except OSError:
                    continue
    except OSError:
        pass
    return result


def _upsert_active_volume() -> dict:
    root = Path(config.MEDIA_ROOT)
    label = _default_label()
    online = root.is_dir() and os.access(root, os.W_OK)
    probed = _probe_mount(root) if online else {"device": None, "fs_uuid": None, "fs_type": None}
    now = db.now()

    row = db.q1("select * from storage_volumes where label = %s", (label,))
    if row is None:
        vol_id = db.new_id()
        db.x(
            "insert into storage_volumes (id,label,kind,mount_path,media_prefix,"
            "device,fs_uuid,fs_type,is_active,is_online,checked_at)"
            " values (%s,%s,'local',%s,'',%s,%s,%s,true,%s,%s)",
            (vol_id, label, str(root), probed["device"], probed["fs_uuid"],
             probed["fs_type"], online, now))
    else:
        vol_id = row["id"]
        db.x(
            "update storage_volumes set mount_path=%s, device=%s, fs_uuid=%s, fs_type=%s,"
            " is_active=true, is_online=%s, checked_at=%s where id=%s",
            (str(root), probed["device"], probed["fs_uuid"], probed["fs_type"],
             online, now, vol_id))
    # Kismi tekil indeks (storage_volumes_single_active) TEK etkin birim ister.
    db.x("update storage_volumes set is_active=false where id <> %s and is_active", (vol_id,))
    return db.q1("select * from storage_volumes where id=%s", (vol_id,))


def active_volume() -> dict:
    """Etkin birimi döndürür; yoksa config'ten upsert eder ve donanımı yoklar."""
    row = db.q1("select * from storage_volumes where is_active limit 1")
    return row if row is not None else _upsert_active_volume()


def sync_volume() -> dict:
    """Açılışta çağrılır: config.MEDIA_ROOT'u etkin birim olarak kaydeder,
    device/fs_uuid/fs_type'ı yoklar, is_online/checked_at günceller.

    ASLA raise ETMEZ: baglı disk yoksa metin sohbeti calismaya devam eder,
    ek yuklemesi patlar — config.validate()'in zaten aldigi durus (CONTRACT-V2 §8).
    """
    try:
        return _upsert_active_volume()
    except Exception:
        return {}


def _volume(volume_id) -> dict | None:
    return db.q1("select * from storage_volumes where id = %s", (volume_id,))


def _path_in(root: Path, key: str) -> Path:
    """Göreli anahtarı verilen köke kilitli mutlak yola çevirir — media.path_of
    ile AYNI kilitleme mantığı, ama kök media.py'nin config okuyan root()'u
    değil, birimin mount_path/media_prefix'i (CONTRACT-V2 §4: media.path_in
    henüz media.py'de yok, bkz. dosya başı notu)."""
    if not key:
        raise media.MediaError("corrupt", "Gecersiz depolama anahtari.")
    base = root.resolve()
    candidate = (base / key).resolve()
    try:
        candidate.relative_to(base)
    except ValueError as e:
        raise media.MediaError("corrupt", "Gecersiz depolama anahtari.") from e
    return candidate


def abs_path(row: dict, thumb: bool = False) -> Path:
    """Satırın birimine göre mutlak yol. Birim çevrimdışıysa da yol üretir —
    var olup olmadığını çağıran kontrol eder.
    """
    key = row["thumb_key"] if thumb else row["storage_key"]
    if not key:
        raise media.MediaError("corrupt", "Gecersiz depolama anahtari.")
    volume = _volume(row["volume_id"])
    if volume is None:
        raise media.MediaError("corrupt", "Depolama birimi bulunamadi.")
    root = Path(volume["mount_path"]) / volume["media_prefix"]
    return _path_in(root, key)


def accel_relpath(row: dict, thumb: bool = False) -> str:
    """X-Accel-Redirect için birimin kökÜNE göreli yol (CONTRACT-V2 §10).

    Nginx'in `internal;` location'ı bu kökte durur — abs_path ile AYNI
    kilitleme kontrolünden geçer, sadece mutlak değil göreli döner.
    """
    key = row["thumb_key"] if thumb else row["storage_key"]
    volume = _volume(row["volume_id"])
    if volume is None:
        raise media.MediaError("corrupt", "Depolama birimi bulunamadi.")
    root = (Path(volume["mount_path"]) / volume["media_prefix"]).resolve()
    resolved = _path_in(root, key)
    return resolved.relative_to(root).as_posix()


def _checksum_of(volume: dict, storage_key: str) -> str | None:
    """sha256 hex — media.py bu batch'te checksum döndürmüyor (dosya başı
    notu), bayt zaten diskte, en ucuz yol tekrar okumak."""
    try:
        path = _path_in(Path(volume["mount_path"]) / volume["media_prefix"], storage_key)
        digest = hashlib.sha256()
        with open(path, "rb") as f:
            for chunk in iter(lambda: f.read(65536), b""):
                digest.update(chunk)
        return digest.hexdigest()
    except OSError:
        return None


# --- ekler: yazma + okuma (CONTRACT-V2 §1b, §4) ----------------------------


def attach(owner_type: str, owner_id, uploader_id, saved: dict) -> dict:
    """media.save() çıktısını bir ek satırına yazar. Sahiplik GENİŞ: owner_type
    ∈ {event,item,node,team} — bu batch'te SADECE event bağlanıyor (çağıran
    tarafta), ama satır ve fonksiyon dört türü de kabul eder (CONTRACT-V2 §1b).
    """
    if owner_type not in OWNER_TYPES:
        raise ValueError(f"gecersiz owner_type: {owner_type!r}")
    volume = active_volume()
    checksum = saved.get("checksum") or _checksum_of(volume, saved["storage_key"])
    attachment_id = db.new_id()
    db.x(
        "insert into attachments (id,owner_type,owner_id,volume_id,uploader_id,mime,"
        "byte_size,checksum,width,height,original_name,storage_key,thumb_key,created_at)"
        " values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)",
        (attachment_id, owner_type, db.uid(owner_id), volume["id"],
         db.uid(uploader_id) if uploader_id else None, saved["mime"], saved["byte_size"],
         checksum, saved.get("width"), saved.get("height"), saved.get("original_name"),
         saved["storage_key"], saved.get("thumb_key"), db.now()))
    return get(attachment_id)


def get(attachment_id) -> dict | None:
    """Tek satır, HAM (deleted_at filtrelenmez — çağıran karar verir)."""
    id_ = db.uid(attachment_id)
    if id_ is None:
        return None
    return db.q1("select * from attachments where id = %s", (id_,))


def for_owners(owner_type: str, owner_ids: list) -> dict:
    """owner_id -> [ek satırı,...], TEK sorgu (spec/10-kararlar.md N+1 yasağı).

    Silinenler DAHİL döner (mezar taşı çizilebilsin) — kullanıcı burada yok,
    ekran biçimine çevirme (can_delete dahil) çağıranın işi: for_owners
    kullanıcıyı bilmez (CONTRACT-V2 §4 imzası), yetki hesap saf bir işlemdir.
    """
    ids = [i for i in (db.uid(o) for o in owner_ids) if i is not None]
    if not ids:
        return {}
    rows = db.q(
        "select * from attachments where owner_type = %s and owner_id = any(%s)"
        " order by created_at", (owner_type, ids))
    out: dict = {}
    for r in rows:
        out.setdefault(r["owner_id"], []).append(r)
    return out


def soft_delete(attachment: dict, user) -> None:
    """Yumuşak silme: deleted_at/deleted_by yazılır, sonra blob'lar silinir.

    Yetki çağıranın işi (can_delete) — burası sadece uygular. events satırı
    ve metni KALIR (sözleşme §6): balon '(görsel silindi)' mezar taşıyla
    yeniden çizilir.
    """
    db.x("update attachments set deleted_at = %s, deleted_by = %s where id = %s",
         (db.now(), user["id"], attachment["id"]))
    for thumb in (False, True):
        key = attachment["thumb_key"] if thumb else attachment["storage_key"]
        if not key:
            continue
        try:
            path = abs_path(attachment, thumb=thumb)
        except media.MediaError:
            continue
        try:
            path.unlink()
        except FileNotFoundError:
            pass


# --- izin (CONTRACT-V2 §5) --------------------------------------------------


def can_view(user, attachment) -> bool:
    """Ek, asıldığı kartın kuralına uyar.

    BUGÜN: oturumu olan herkes kartları okuyabiliyor (routes.task_page kapsam
    kontrolü yapmıyor), o yüzden ek de öyle. Kart okuması daraltılırsa
    değişecek yer burasıdır.
    """
    return user is not None and attachment is not None


def can_delete(user, attachment) -> bool:
    """Silme: yükleyen ya da admin — batch 1'in semantiği aynen."""
    if user is None or attachment is None:
        return False
    return db.as_bool(user["is_admin"]) or attachment["uploader_id"] == user["id"]


def _participates_in_item(user, item_id) -> bool:
    item_id = db.uid(item_id)
    if item_id is None:
        return False
    if user["id"] in auth.participant_ids(item_id):
        return True
    item = db.q1("select * from items where id = %s", (item_id,))
    if item is None:
        return False
    if item["assignee_id"] == user["id"]:
        return True
    from . import service  # dongusel import onlemi: service bu modulu (attach/for_owners) kullanir
    return auth.can_edit_item(user, item, service.TREE)


def _participates(user, attachment) -> bool:
    """Katılım, sahibin türüne göre çözülür (CONTRACT-V2 §5 tablosu)."""
    if user is None:
        return False
    if db.as_bool(user["is_admin"]):
        return True
    owner_type, owner_id = attachment["owner_type"], attachment["owner_id"]
    if owner_type == "event":
        event = db.q1("select subject_type, subject_id from events where id = %s", (owner_id,))
        if event is None:
            return False
        if event["subject_type"] == "team":
            return db.uid(event["subject_id"]) in auth.team_ids(user["id"])
        if event["subject_type"] == "item":
            return _participates_in_item(user, event["subject_id"])
        return False
    if owner_type == "item":
        return _participates_in_item(user, owner_id)
    if owner_type == "team":
        return db.uid(owner_id) in auth.team_ids(user["id"])
    if owner_type == "node":
        from . import scope  # dongusel import onlemi: scope service'i, service bizi kullanir
        return scope.authorized_on_node(user, owner_id)
    if owner_type == "card":
        # Kart blogu kaydin govdesinde durur: katilim sorusu KAYDIN sorusudur,
        # ikinci bir model kurulmaz (goc 012).
        row = db.q1("select item_id from item_cards where id = %s", (db.uid(owner_id),))
        return row is not None and _participates_in_item(user, row["item_id"])
    return False


def can_tag(user, attachment) -> bool:
    """Etiketleme: DOĞRU KAPSAM + O SOHBETE KATILIM. İkisi birden gerekir.

    Kapsam tek başına yetmez — 'katıldığın sohbetlerdeki' kısmı kullanıcının
    şartı, kapsamın değil. Admin ikisini de atlar: active_scopes() admin için
    zaten tüm kapsamları döner, _participates de admin'i ayrıca kısa yoldan
    geçirir (shared/scope.py'deki yerleşik kuralla tutarlı).
    """
    if user is None or attachment is None:
        return False
    from . import scope
    if not scope.has_scope(user, "tag_media"):
        return False
    return _participates(user, attachment)


# --- etiketler (CONTRACT-V2 §2, §6) ----------------------------------------


def tags_for(attachment_ids: list) -> dict:
    """attachment_id -> [etiket dict,...], TEK sorgu (N+1 yasağı)."""
    ids = [i for i in (db.uid(a) for a in attachment_ids) if i is not None]
    if not ids:
        return {}
    rows = db.q(
        "select at.attachment_id, t.id, t.name, t.slug, t.color"
        " from attachment_tags at join tags t on t.id = at.tag_id"
        " where at.attachment_id = any(%s) order by t.name", (ids,))
    out: dict = {}
    for r in rows:
        out.setdefault(r["attachment_id"], []).append(
            {"id": r["id"], "name": r["name"], "slug": r["slug"], "color": r["color"]})
    return out


def all_tags() -> list:
    """Sözlüğün tamamı — /tags ucu, datalist için (CONTRACT-V2 §6)."""
    return db.q("select * from tags order by name")


def add_tag(user, attachment: dict, name: str) -> dict:
    """Var olan etikete katılım: tag_media + katılım yeter (çağıran can_tag'i
    önceden kontrol etmiş olmalı). YENİ etiket ayrıca create_tags ister —
    kelime dağarcığını genişletmek uygulamaktan farklı bir ayrıcalık
    (CONTRACT-V2 §3, §5): "role creation" ile "role assignment" ayrımıyla aynı desen.
    """
    name = (name or "").strip()
    if not name:
        raise HTTPException(400, "etiket adı zorunlu")
    slug = slugify(name)
    tag = db.q1("select * from tags where slug = %s", (slug,))
    if tag is None:
        from . import scope
        if not scope.has_scope(user, "create_tags"):
            raise HTTPException(403, "yeni etiket tanımlamak için yetkin yok")
        tag_id = db.new_id()
        db.x("insert into tags (id,name,slug,created_by,created_at) values (%s,%s,%s,%s,%s)",
             (tag_id, name, slug, user["id"] if user else None, db.now()))
        tag = db.q1("select * from tags where id = %s", (tag_id,))
    db.x("insert into attachment_tags (attachment_id, tag_id, added_by, added_at)"
         " values (%s,%s,%s,%s) on conflict (attachment_id, tag_id) do nothing",
         (attachment["id"], tag["id"], user["id"] if user else None, db.now()))
    return tag


def remove_tag(user, attachment: dict, tag_id) -> None:
    """Yetki çağıranın işi (can_tag) — burası sadece siler."""
    tid = db.uid(tag_id)
    if tid is None:
        return
    db.x("delete from attachment_tags where attachment_id = %s and tag_id = %s",
         (attachment["id"], tid))
