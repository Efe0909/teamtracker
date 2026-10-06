"""Demo tohumunun mekanigi: API istemcisi, psql sarmalayicisi, sanal saat.

Tohum GERCEK uclari cagirir (etkinlik ikizi, etkinlik akisi, kart JSON'u gibi
degismezler uygulamanin kendisinden gelir). Tek eksik: gecmis. Uclar her seyi
"simdi" yazar; bu yuzden her cagrinin gercek zaman penceresi kaydedilir ve en
sonda TEK SQL ile o pencerelerdeki butun zaman damgalari sanal ana kaydirilir.

Yalniz standart kutuphane. Yerel DB'ye karsi calisir; `guard()` canliya
(baska host / `demo` icermeyen veritabani) karsi calismayi reddeder.
"""

from __future__ import annotations

import datetime as dt
import http.cookiejar
import json
import os
import subprocess
import time
import urllib.error
import urllib.parse
import urllib.request
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Europe/Istanbul")


def q(value: str) -> str:
    """SQL metin degeri (tek tirnak kacisi)."""
    return "'" + value.replace("'", "''") + "'"


class ApiError(Exception):
    def __init__(self, method: str, path: str, status: int, code: str):
        super().__init__(f"{method} {path} -> {status} {code}")
        self.status, self.code = status, code


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):  # dev-login 303 doner; cerez yeter
        return None


class Psql:
    """`PSQL` ortam degiskeni: tam psql komutu (docker exec ... ya da PGPASSWORD=... psql ...)."""

    def __init__(self, cmd: str):
        self.cmd = f"{cmd} -X -q -t -A -v ON_ERROR_STOP=1"

    def run(self, sql: str) -> str:
        p = subprocess.run(self.cmd, shell=True, input=sql, text=True, capture_output=True)
        if p.returncode != 0:
            raise RuntimeError(f"psql: {p.stderr.strip()}\n--- sql:\n{sql[:600]}")
        return p.stdout.strip()


def guard(api: str, psql: Psql) -> None:
    """Canliya karsi calismayi reddet: yalniz yerel API + adinda `demo` gecen veritabani."""
    host = urllib.parse.urlparse(api).hostname
    if host not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit(f"red: API yerel degil ({host})")
    name = psql.run("select current_database()")
    if "demo" not in name:
        raise SystemExit(f"red: veritabani adi 'demo' icermiyor ({name}); canli veriye dokunulmaz")


class Session:
    """Bir kullanicinin oturumu: sahte giris cerezi + CSRF belirteci."""

    def __init__(self, api: "Api", user_id: str, name: str):
        self.api, self.id, self.name = api, user_id, name
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.jar), _NoRedirect())
        try:
            self.opener.open(f"{api.base}/api/auth/dev-login?user_id={user_id}")
        except urllib.error.HTTPError as e:
            if e.code != 303:
                raise
        me = self._send("GET", "/api/me", record=False)
        if me["user"] is None:
            raise RuntimeError(f"giris olmadi: {name}")
        self.csrf = me["csrf"]

    def _send(self, method: str, path: str, body=None, raw: bytes | None = None,
              record: bool = True):
        headers = {"Accept": "application/json"}
        data = None
        if method != "GET":
            headers["X-CSRF-Token"] = getattr(self, "csrf", "")
        if raw is not None:
            data = raw
        elif body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(f"{self.api.base}{path}", data=data, method=method, headers=headers)
        if record and method != "GET":
            self.api.clock.stamp()
        try:
            with self.opener.open(req) as r:
                text = r.read().decode()
                return json.loads(text) if text else None
        except urllib.error.HTTPError as e:
            text = e.read().decode()
            try:
                code = json.loads(text).get("error", "?")
            except Exception:
                code = text[:80]
            raise ApiError(method, path, e.code, code) from None

    def get(self, path):
        return self._send("GET", path)

    def post(self, path, body=None):
        return self._send("POST", path, body if body is not None else {})

    def patch(self, path, body):
        return self._send("PATCH", path, body)

    def put(self, path, body=None):
        return self._send("PUT", path, body if body is not None else {})

    def delete(self, path):
        return self._send("DELETE", path)

    def upload(self, path: str, name: str) -> str:
        """Gorseli sahipsiz ek olarak yukler, ek kimligini doner."""
        with open(path, "rb") as f:
            raw = f.read()
        out = self._send("POST", f"/api/attachments?name={urllib.parse.quote(name)}", raw=raw)
        return out["id"]


class Clock:
    """Sanal saat. `at(gun_once, "SS:DD")` ile kurulur; her yazan cagri bir pencere kaydeder."""

    def __init__(self):
        self.virtual: dt.datetime | None = None
        self.windows: list[tuple[float, dt.datetime]] = []
        self.step = dt.timedelta(minutes=2)

    def at(self, days_ago: int, hhmm: str, step_min: int = 2) -> "Clock":
        today = dt.datetime.now(TZ).date()
        h, m = map(int, hhmm.split(":"))
        self.virtual = dt.datetime.combine(today - dt.timedelta(days=days_ago), dt.time(h, m), TZ)
        self.step = dt.timedelta(minutes=step_min)
        return self

    def wait(self, minutes: int) -> None:
        if self.virtual is not None:
            self.virtual += dt.timedelta(minutes=minutes)

    def stamp(self) -> None:
        """Yazan her cagridan ONCE: bu cagrinin sanal ani = simdiki sanal an."""
        if self.virtual is None:
            return
        # Ayni gercek ani paylasan iki cagri olamaz; yine de tekil kalsin.
        t = time.time()
        if self.windows and t <= self.windows[-1][0]:
            t = self.windows[-1][0] + 1e-4
        self.windows.append((t, self.virtual))
        self.virtual += self.step


class Api:
    def __init__(self, base: str, psql: Psql):
        self.base, self.psql = base.rstrip("/"), psql
        self.clock = Clock()
        self._sessions: dict[str, Session] = {}
        self.users: dict[str, str] = {}  # anahtar -> kullanici kimligi

    def as_(self, key: str) -> Session:
        if key not in self._sessions:
            self._sessions[key] = Session(self, self.users[key], key)
        return self._sessions[key]

    def shift(self) -> None:
        """Kaydedilen pencerelerdeki butun zaman damgalarini sanal ana kaydir (TEK gecis)."""
        if not self.clock.windows:
            return
        rows = ",".join(
            f"({t!r}, '{v.astimezone(dt.timezone.utc).isoformat()}'::timestamptz)"
            for t, v in self.clock.windows)
        self.psql.run(f"""
begin;
create temp table w(real_s double precision, virt timestamptz) on commit drop;
insert into w values {rows};
create temp table win on commit drop as
  select to_timestamp(real_s) as a,
         coalesce(to_timestamp(lead(real_s) over (order by real_s)), to_timestamp(real_s) + interval '20 seconds') as b,
         to_timestamp(real_s) - virt as delta
    from w;
alter table records disable trigger records_touch;
do $$
declare r record;
begin
  for r in select c.table_name t, c.column_name c from information_schema.columns c
            join information_schema.tables t using (table_schema, table_name)
            where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
              and c.data_type = 'timestamp with time zone'
              and c.table_name not in ('_sqlx_migrations') loop
    execute format('update %I x set %I = x.%I - w.delta from win w where x.%I >= w.a and x.%I < w.b',
                   r.t, r.c, r.c, r.c, r.c);
  end loop;
end $$;
alter table records enable trigger records_touch;
commit;
""")
        self.clock.windows.clear()
