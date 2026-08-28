"""Test ortami: gercek Google girisi yerine sahte kimlik.

Ortam degiskenleri app/config import edilmeden ONCE kurulmali; conftest bunun
icin dogru yer. Olumcul yapilandirma kontrolleri testte uyariya doner
(shared/config._test_kosumu) — yayin surecinde pytest yoktur.
"""
import os

os.environ.setdefault("EKIPTAKIP_AUTH", "sahte")
os.environ.setdefault("EKIPTAKIP_SECRET_KEY", "test-" + "y" * 40)
# Olumcul yapilandirma kontrolleri testte uyariya doner. Bu bayrak YAYINDA
# yok sayilir (shared/config._test_kosumu) — arka kapi degil.
os.environ["EKIPTAKIP_TEST_YAPILANDIRMA"] = "1"


import re  # noqa: E402

import pytest  # noqa: E402

TOKEN_DESENI = re.compile(r'X-CSRF-Token": "([^"]+)"')


@pytest.fixture
def csrf(client):
    """Istemciye CSRF token'ini varsayilan baslik olarak takar.

    Token oturumda durur; sayfadan okunur (tarayicinin yaptigi da bu).
    """
    return csrf_tak(client)


def csrf_tak(client, yol: str = "/") -> str:
    m = TOKEN_DESENI.search(client.get(yol).text)
    assert m, f"{yol} sayfasinda CSRF token'i yok"
    client.headers["X-CSRF-Token"] = m.group(1)
    return m.group(1)
