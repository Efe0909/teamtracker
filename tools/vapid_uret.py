"""VAPID anahtar cifti uretir (spec/40-push.md).

  .venv/bin/python tools/vapid_uret.py

Ciktiyi .env'e yapistir. Sunucuda .env agenix ile sifreli duruyor
(deploy/DOCKER.md "agenix"), yani orada sirri yeniden sifrelemen gerekir.

DIKKAT: anahtar DEGISIRSE mevcut tum abonelikler gecersizlesir — herkesin
telefonundan yeniden abone olmasi gerekir. Bir kez uret, sakla.

Neden py_vapid'in kendi yardimcilari degil: py_vapid 1.9.4'te
`public_key_urlsafe()` yok ve surumler arasi ad degisiyor. Anahtarlar
dogrudan `cryptography` ile turetiliyor — pywebpush'un bekledigi ham
base64url bicimi (push demosunda da bu yol calisti).
"""
from __future__ import annotations

import base64

from cryptography.hazmat.primitives.asymmetric import ec


def b64(ham: bytes) -> str:
    """base64url, dolgu ('=') YOK — web push bicimi."""
    return base64.urlsafe_b64encode(ham).rstrip(b"=").decode()


def main() -> None:
    anahtar = ec.generate_private_key(ec.SECP256R1())

    # Gizli: 32 baytlik ham skaler.
    gizli = anahtar.private_numbers().private_value.to_bytes(32, "big")

    # Acik: 65 baytlik sikistirilmamis P-256 noktasi (0x04 + X + Y).
    sayilar = anahtar.public_key().public_numbers()
    acik = b"\x04" + sayilar.x.to_bytes(32, "big") + sayilar.y.to_bytes(32, "big")

    print("# .env'e ekle — bu degerler ASLA depoya girmez")
    print(f"VAPID_PRIVATE={b64(gizli)}")
    print(f"VAPID_PUBLIC={b64(acik)}")
    print("VAPID_SUB=mailto:kadirefeatcali@gmail.com")


if __name__ == "__main__":
    main()
