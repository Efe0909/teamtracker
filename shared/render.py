"""Sablon yukleme. Her site kendi dizinini gorur, artı ortak parcalar.

Ortak parca (mesaj balonu) iki sitede de ayni; skin kurali geregi nerede
gosterildigini bilmez, o yuzden paylasilabiliyor.
"""
from __future__ import annotations

from pathlib import Path

from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

from . import config

ORTAK = Path(__file__).parent / "templates"


def site_templates(dizin: Path) -> Jinja2Templates:
    t = Jinja2Templates(directory=[dizin, ORTAK])
    # Sablon "kimlik sahte mi" bilsin: kullanici degistirme listesi yalnizca
    # gelistirmede gorunur, yayinda yerine cikis dugmesi durur.
    t.env.globals["sahte_kimlik"] = config.sahte_kimlik
    return t


def render(templates: Jinja2Templates, request, name: str, ctx: dict) -> HTMLResponse:
    return templates.TemplateResponse(request, name, ctx)


def is_htmx(request) -> bool:
    return request.headers.get("HX-Request") == "true"
