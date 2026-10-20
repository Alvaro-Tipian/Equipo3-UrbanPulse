"""CORS de los webhooks /urbanpulse/* (HT-36 T02).

Cada webhook de UrbanPulse acepta solo los orígenes de la app (producción,
staging y localhost), no "*". La lista y el comportamiento de n8n están en
docs/CORS_WEBHOOKS.md; si se agrega un dominio, se cambia aquí y en el doc.
"""

import json
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[3]
CARPETAS = [RAIZ / "ia-ops" / "workflows", RAIZ / "src" / "n8n-workflows" / "production"]

PRODUCCION = "https://equipo3-urban-pulse.vercel.app"
ORIGENES = [
    PRODUCCION,
    # Host de staging (rama staging), ver infrastructure/README.md
    "https://equipo3-u-git-cc0c7a-sebastiannnnnnnnnnnnnnnnnnnnnnnns-projects.vercel.app",
    "http://localhost:3000",  # src/frontend (host)
    "http://localhost:3003",  # mf-chatbot
    "http://localhost:5173",  # mf-gestion-incidentes
    "http://localhost:5174",  # mf-mapa-urbano
    "http://localhost:5175",  # mf-dashboard
    "http://localhost:5176",  # mf-historial-reportes
    "http://localhost:5177",  # mf-auth
    "http://localhost:5178",  # mf-ajustes
    "http://localhost:5181",  # mf-panel-riesgo
]


def webhooks_urbanpulse():
    for carpeta in CARPETAS:
        for archivo in sorted(carpeta.glob("*.json")):
            workflow = json.loads(archivo.read_text(encoding="utf-8"))
            for nodo in workflow.get("nodes", []):
                ruta = nodo.get("parameters", {}).get("path", "")
                if nodo.get("type") == "n8n-nodes-base.webhook" and ruta.startswith("urbanpulse/"):
                    yield pytest.param(nodo, id=f"{archivo.name}:{ruta}")


def cabecera_allow_origin(allowed_origins, origen):
    """Lo que n8n pone en Access-Control-Allow-Origin.

    Copia de WebhookRequestHandler.setupCorsHeaders (n8n 2.x): si el origen
    no está en la lista, responde el primero de la lista y el navegador
    bloquea la respuesta. Ojo: la lista se separa por comas SIN recortar
    espacios, por eso no puede llevar espacios.
    """
    if allowed_origins and allowed_origins != "*" and allowed_origins != origen:
        lista = allowed_origins.split(",")
        return origen if origen in lista else lista[0]
    return origen


WEBHOOKS = list(webhooks_urbanpulse())


def test_se_encontraron_los_webhooks():
    # Central (5), Dashboard KPIs (9), estado, eventos y despliegue (2 copias c/u)
    assert len(WEBHOOKS) >= 20


@pytest.mark.parametrize("nodo", WEBHOOKS)
def test_webhook_solo_acepta_los_origenes_de_la_app(nodo):
    permitidos = nodo["parameters"].get("options", {}).get("allowedOrigins")
    # Sin la opción, n8n devuelve el origen que le pidan: es lo mismo que "*".
    assert permitidos, "falta allowedOrigins"
    assert " " not in permitidos, "n8n no recorta espacios: el origen no coincidiría"
    assert permitidos.split(",") == ORIGENES


@pytest.mark.parametrize("origen", ORIGENES)
def test_la_app_recibe_su_propio_origen(origen):
    assert cabecera_allow_origin(",".join(ORIGENES), origen) == origen


@pytest.mark.parametrize("origen", [
    "https://atacante.example",
    "https://equipo3-urban-pulse.vercel.app.atacante.example",
    "http://localhost:8080",
    "null",
])
def test_un_origen_ajeno_no_recibe_su_origen(origen):
    # El navegador compara Access-Control-Allow-Origin con su propio origen:
    # al recibir el de producción, bloquea la respuesta.
    assert cabecera_allow_origin(",".join(ORIGENES), origen) == PRODUCCION


def test_con_asterisco_cualquier_origen_pasaba():
    # Lo que había antes de HT-36 T02.
    assert cabecera_allow_origin("*", "https://atacante.example") == "https://atacante.example"
