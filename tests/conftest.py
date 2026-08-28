"""Test ortami: gercek Google girisi yerine sahte kimlik.

Ortam degiskenleri app/config import edilmeden ONCE kurulmali; conftest bunun
icin dogru yer. Olumcul yapilandirma kontrolleri testte uyariya doner
(shared/config._test_kosumu) — yayin surecinde pytest yoktur.
"""
import os

os.environ.setdefault("EKIPTAKIP_AUTH", "sahte")
os.environ.setdefault("EKIPTAKIP_SECRET_KEY", "test-" + "y" * 40)
