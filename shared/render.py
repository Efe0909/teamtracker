"""Sablon yukleme. Her site kendi dizinini gorur, artı ortak parcalar.

Ortak parca (mesaj balonu) iki sitede de ayni; skin kurali geregi nerede
gosterildigini bilmez, o yuzden paylasilabiliyor.
"""
from __future__ import annotations

from pathlib import Path

from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

ORTAK = Path(__file__).parent / "templates"


def site_templates(dizin: Path) -> Jinja2Templates:
    return Jinja2Templates(directory=[dizin, ORTAK])


def render(templates: Jinja2Templates, request, name: str, ctx: dict) -> HTMLResponse:
    return templates.TemplateResponse(request, name, ctx)


def is_htmx(request) -> bool:
    return request.headers.get("HX-Request") == "true"
