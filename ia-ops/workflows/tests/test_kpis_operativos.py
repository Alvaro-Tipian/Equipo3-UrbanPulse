"""Webhook de KPIs de operativos (HU-11 T01, contrato C4).

Vive en el workflow Dashboard KPIs, que solo tiene copia en
src/n8n-workflows/production. Igual que test_operativos.py: el nodo Code corre
en Node.js y la consulta SQL corre tal cual contra Postgres, dentro de una
transaccion que se revierte al final.

  TEST_DATABASE_URL=postgresql://usuario:clave@localhost:5432/urbanpulse_db pytest
"""

import json
import re
import subprocess
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[3]
WORKFLOW = RAIZ / "src" / "n8n-workflows" / "production" / "UrbanPulse - Dashboard KPIs vr2.json"
HARNESS = Path(__file__).with_name("ejecutar_nodo.mjs")

WF = json.loads(WORKFLOW.read_text(encoding="utf-8"))
NODOS = {n["name"]: n for n in WF["nodes"]}
AHORA = datetime.now(timezone.utc)


def ejecutar(nodo, entrada):
    proc = subprocess.run(
        ["node", str(HARNESS), str(WORKFLOW), nodo],
        input=json.dumps({"entrada": entrada, "nodos": {}}),
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
    return json.loads(proc.stdout)


def siguientes(nodo):
    return [[d["node"] for d in salida] for salida in WF["connections"][nodo]["main"]]


# ---------------------------------------------------------------------------
# Estructura del workflow
# ---------------------------------------------------------------------------

def test_el_webhook_responde_con_un_nodo_respond():
    webhook = NODOS["Webhook KPIs Operativos"]["parameters"]
    assert webhook["path"] == "urbanpulse/kpis-operativos"
    assert webhook.get("httpMethod", "GET") == "GET"
    # Sin responseNode no se pueden devolver 401 ni 403.
    assert webhook["responseMode"] == "responseNode"


def test_sin_token_valido_no_se_consulta_la_base():
    assert siguientes("Webhook KPIs Operativos") == [["Validar token (kpis operativos)"]]
    assert siguientes("Validar token (kpis operativos)") == [["Token valido? (kpis operativos)"]]
    assert siguientes("Token valido? (kpis operativos)") == [
        ["Consultar KPIs de operativos"],
        ["Responder error de token (kpis operativos)"],
    ]


def test_la_respuesta_lleva_el_cuerpo_y_el_codigo_del_nodo_code():
    assert siguientes("Consultar KPIs de operativos") == [["Armar KPIs de operativos"]]
    assert siguientes("Armar KPIs de operativos") == [["Responder: KPIs de operativos"]]
    respuesta = NODOS["Responder: KPIs de operativos"]["parameters"]
    assert "$json.cuerpo" in respuesta["responseBody"]
    assert "$json.http_code" in respuesta["options"]["responseCode"]


# ---------------------------------------------------------------------------
# Nodo Code
# ---------------------------------------------------------------------------

def test_armar_respuesta_cumple_el_contrato_c4():
    operativo = {"id": "x", "zona": "Miraflores", "tipo_principal": "bache", "incluidos": 5,
                 "resueltos": 4, "efectividad": 0.8, "horas_atencion": 26.5}
    tiempo = {"tipo": "bache", "semana": "2026-W44", "horas_promedio": 31.2}
    salida = ejecutar("Armar KPIs de operativos", [{
        "operativos": [operativo], "tiempo_por_tipo": [tiempo],
        "actualizado": "2026-10-27T18:30:00Z", "sobra": True,
    }])[0]
    assert salida == {"http_code": 200, "cuerpo": {
        "operativos": [operativo], "tiempo_por_tipo": [tiempo],
        "actualizado": "2026-10-27T18:30:00Z",
    }}


def test_sin_datos_responde_listas_vacias():
    salida = ejecutar("Armar KPIs de operativos", [{"actualizado": "2026-10-27T18:30:00Z"}])[0]
    assert salida["cuerpo"]["operativos"] == []
    assert salida["cuerpo"]["tiempo_por_tipo"] == []


# ---------------------------------------------------------------------------
# Consulta SQL
# ---------------------------------------------------------------------------

psycopg = pytest.importorskip("psycopg")


@pytest.fixture
def conn(dsn):
    with psycopg.connect(dsn) as c:
        yield c
        c.rollback()


@pytest.fixture
def cur(conn):
    with psycopg.RawCursor(conn) as cursor:
        cursor.execute("TRUNCATE operativo_reportes, operativos")
        cursor.execute("DELETE FROM reports")
        cursor.execute(
            "INSERT INTO cuadrillas (nombre, especialidad) VALUES ('KPI 1', 'bacheo')"
            " ON CONFLICT (nombre) DO NOTHING"
        )
        yield cursor


def reporte(cur, tipo="bache", status="resuelto", creado=None, resuelto=None):
    rid = str(uuid.uuid4())
    cur.execute(
        "INSERT INTO reports (id, description, incident_type, latitude, longitude,"
        " status, created_at, resolved_at) VALUES ($1, 'x', $2, -12.1, -77.0, $3, $4, $5)",
        (rid, tipo, status, creado or AHORA - timedelta(days=1), resuelto),
    )
    return rid


def operativo(cur, reportes, zona="MIRAFLORES", estado="cerrado", dias=1, horas=26.5):
    """Operativo cerrado hace `dias`, que duro `horas` desde su creacion."""
    oid = str(uuid.uuid4())
    cerrado = AHORA - timedelta(days=dias)
    creado = cerrado - timedelta(hours=horas)
    cur.execute(
        "INSERT INTO operativos (id, zona, estado, cuadrilla_id, creado_en, asignado_en,"
        " cerrado_en) VALUES ($1, $2, $3, (SELECT id FROM cuadrillas WHERE nombre = 'KPI 1'),"
        " $4, $4, $5)",
        (oid, zona, estado, creado, cerrado if estado == "cerrado" else None),
    )
    for rid in reportes:
        cur.execute(
            "INSERT INTO operativo_reportes (operativo_id, reporte_id) VALUES ($1, $2)",
            (oid, rid),
        )
    return oid


def consultar(cur):
    cur.execute(NODOS["Consultar KPIs de operativos"]["parameters"]["query"])
    fila = dict(zip([c.name for c in cur.description], cur.fetchone()))
    return fila


def test_mide_la_efectividad_y_las_horas_del_operativo(cur):
    resueltos = [reporte(cur, resuelto=AHORA) for _ in range(4)]
    abierto = reporte(cur, status="pending")
    oid = operativo(cur, resueltos + [abierto])

    fila = consultar(cur)

    assert fila["operativos"] == [{
        "id": oid, "zona": "Miraflores", "tipo_principal": "bache", "incluidos": 5,
        "resueltos": 4, "efectividad": 0.8, "horas_atencion": 26.5,
    }]
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", fila["actualizado"])


def test_el_tipo_principal_es_el_mas_frecuente(cur):
    tipos = ["semaforo", "semaforo", "bache"]
    operativo(cur, [reporte(cur, tipo=t, resuelto=AHORA) for t in tipos])
    assert consultar(cur)["operativos"][0]["tipo_principal"] == "semaforo"


def test_una_zona_sin_distrito_tiene_nombre_para_mostrar(cur):
    operativo(cur, [reporte(cur, resuelto=AHORA)], zona="SIN_DISTRITO")
    assert consultar(cur)["operativos"][0]["zona"] == "Sin distrito"


def test_solo_cuenta_los_cerrados_de_las_ultimas_4_semanas(cur):
    operativo(cur, [reporte(cur, status="pending")], estado="en_curso")
    operativo(cur, [reporte(cur, resuelto=AHORA)], dias=29)
    reciente = operativo(cur, [reporte(cur, resuelto=AHORA)], dias=27)
    assert [o["id"] for o in consultar(cur)["operativos"]] == [reciente]


def test_ordena_del_cierre_mas_reciente_al_mas_antiguo(cur):
    viejo = operativo(cur, [reporte(cur, resuelto=AHORA)], dias=5)
    nuevo = operativo(cur, [reporte(cur, resuelto=AHORA)], dias=1)
    assert [o["id"] for o in consultar(cur)["operativos"]] == [nuevo, viejo]


def test_el_tiempo_por_tipo_promedia_cada_semana(cur):
    # Lunes al mediodia en Lima: los dos reportes caen en la misma semana ISO.
    fin = AHORA - timedelta(days=AHORA.weekday(), hours=AHORA.hour - 17)
    if fin > AHORA:
        fin -= timedelta(days=7)
    reporte(cur, creado=fin - timedelta(hours=10), resuelto=fin)
    reporte(cur, creado=fin - timedelta(hours=20), resuelto=fin)
    reporte(cur, tipo="semaforo", creado=fin - timedelta(hours=4), resuelto=fin)
    semana = fin.astimezone(timezone(timedelta(hours=-5))).strftime("%G-W%V")

    assert consultar(cur)["tiempo_por_tipo"] == [
        {"tipo": "bache", "semana": semana, "horas_promedio": 15.0},
        {"tipo": "semaforo", "semana": semana, "horas_promedio": 4.0},
    ]


def test_el_tiempo_por_tipo_ignora_lo_abierto_lo_antiguo_y_lo_sin_tipo(cur):
    reporte(cur, status="pending")
    reporte(cur, resuelto=AHORA - timedelta(days=29), creado=AHORA - timedelta(days=30))
    reporte(cur, tipo=None, resuelto=AHORA)
    assert consultar(cur)["tiempo_por_tipo"] == []


def test_sin_operativos_cerrados_devuelve_listas_vacias(cur):
    fila = consultar(cur)
    assert fila["operativos"] == [] and fila["tiempo_por_tipo"] == []
