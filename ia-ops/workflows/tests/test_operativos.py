"""Webhooks de operativos (HU-09 T02, contrato C2 de docs/OPERATIVOS_CONTRACT.md).

Dos clases de prueba, igual que el resto del arnes:

- Los nodos Code se ejecutan de verdad en Node.js con ejecutar_nodo.mjs, con la
  misma entrada que les da n8n.
- Las consultas SQL se ejecutan tal cual estan en el workflow contra un Postgres
  con pgvector, PostGIS y todas las migraciones. Cada prueba corre en una
  transaccion que se revierte al final.

  TEST_DATABASE_URL=postgresql://usuario:clave@localhost:5432/urbanpulse_db pytest
"""

import json
import re
import subprocess
import uuid
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[3]
WORKFLOW = RAIZ / "ia-ops" / "workflows" / "n8n_operativos.json"
PRODUCCION = RAIZ / "src" / "n8n-workflows" / "production" / "urbanpulse-operativos.json"
HARNESS = Path(__file__).with_name("ejecutar_nodo.mjs")

WF = json.loads(WORKFLOW.read_text(encoding="utf-8"))
NODOS = {n["name"]: n for n in WF["nodes"]}

OPERADOR = "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b"
CIUDADANO = "7a2b3c4d-5e6f-4071-9b8c-1d2e3f4a5b6c"


def ejecutar(nodo, entrada, nodos=None):
    """Corre el jsCode del nodo en Node.js, como lo haria n8n."""
    proc = subprocess.run(
        ["node", str(HARNESS), str(WORKFLOW), nodo],
        input=json.dumps({"entrada": entrada, "nodos": nodos or {}}, default=str),
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
    return json.loads(proc.stdout)


def consulta(nodo):
    return NODOS[nodo]["parameters"]["query"]


# ---------------------------------------------------------------------------
# Estructura del workflow
# ---------------------------------------------------------------------------

RUTAS_ESPERADAS = {
    ("urbanpulse/incidentes-por-zona", "GET"),
    ("urbanpulse/operativos", "POST"),
    ("urbanpulse/operativos", "GET"),
    ("urbanpulse/cuadrillas", "GET"),
    ("urbanpulse/operativos/asignar", "POST"),
}


def test_estan_los_cinco_webhooks_del_contrato():
    rutas = {
        (n["parameters"]["path"], n["parameters"].get("httpMethod", "GET"))
        for n in WF["nodes"] if n["type"] == "n8n-nodes-base.webhook"
    }
    assert rutas == RUTAS_ESPERADAS


@pytest.mark.parametrize("nodo", [
    n["name"] for n in WF["nodes"] if n["type"] == "n8n-nodes-base.webhook"
])
def test_cada_webhook_responde_con_un_nodo_respond(nodo):
    # Sin responseNode no se pueden devolver 401, 403, 409 ni 201.
    assert NODOS[nodo]["parameters"]["responseMode"] == "responseNode"


def test_la_copia_de_produccion_es_identica():
    assert json.loads(PRODUCCION.read_text(encoding="utf-8")) == WF


def test_todos_los_nodos_estan_conectados():
    nombres = {n["name"] for n in WF["nodes"]}
    destinos = {
        d["node"]
        for c in WF["connections"].values()
        for salida in c["main"] for d in salida
    }
    for nombre, c in WF["connections"].items():
        assert nombre in nombres
        for salida in c["main"]:
            for d in salida:
                assert d["node"] in nombres
    sueltos = [
        n["name"] for n in WF["nodes"]
        if n["type"] != "n8n-nodes-base.webhook" and n["name"] not in destinos
    ]
    assert sueltos == []


@pytest.mark.parametrize("sufijo", ["operativo.creado", "operativo.cerrado"])
def test_los_eventos_salen_por_el_enrutador_con_header_auth(sufijo):
    http = NODOS["Publicar " + sufijo]
    assert http["parameters"]["url"].endswith("/webhook/urbanpulse/eventos")
    assert http["parameters"]["genericAuthType"] == "httpHeaderAuth"
    # Si el enrutador no contesta, el operador ya recibio su respuesta: el
    # evento se pierde, no la operacion.
    assert http["onError"] == "continueRegularOutput"
    # El enrutador exige UUID v4 y el nodo Crypto los genera asi.
    assert NODOS["Generar ID " + sufijo]["type"] == "n8n-nodes-base.crypto"


def test_el_enrutador_acepta_los_dos_tipos_nuevos():
    router = RAIZ / "ia-ops" / "workflows" / "n8n_event_router.json"
    js = next(
        n for n in json.loads(router.read_text(encoding="utf-8"))["nodes"]
        if n["name"] == "Validar Esquema del Sobre de Eventos"
    )["parameters"]["jsCode"]
    assert "'operativo.creado'" in js and "'operativo.cerrado'" in js


def test_el_catalogo_documenta_los_dos_eventos():
    catalogo = (RAIZ / "docs" / "architecture" / "eventos.md").read_text(encoding="utf-8")
    assert "`operativo.creado`" in catalogo and "`operativo.cerrado`" in catalogo


# ---------------------------------------------------------------------------
# Nodos Code: validacion del cuerpo (400 datos_invalidos)
# ---------------------------------------------------------------------------

def validar_crear(cuerpo, usuario_id=OPERADOR):
    return ejecutar("Validar datos del operativo", [{}], nodos={
        "Webhook Crear Operativo": [{"body": cuerpo}],
        "Validar token (crear)": [{"valido": True, "usuario_id": usuario_id}],
    })[0]


@pytest.mark.parametrize("cuerpo", [
    {},                                                    # sin zona ni reportes
    {"zona": "Miraflores"},                                # sin reportes
    {"zona": "Miraflores", "reportes": []},                # reportes vacio
    {"zona": "", "reportes": [str(uuid.uuid4())]},         # zona vacia
    {"zona": "Miraflores", "reportes": ["no-es-uuid"]},    # id invalido
    {"zona": "Miraflores", "reportes": [str(uuid.uuid4()), "123"]},
    {"zona": "Miraflores", "reportes": str(uuid.uuid4())},  # no es arreglo
])
def test_crear_sin_datos_validos_responde_400(cuerpo):
    assert validar_crear(cuerpo) == {
        "valido": False, "http_code": 400, "error": "datos_invalidos"}


def test_crear_toma_el_usuario_del_token_no_del_cuerpo():
    # Contrato C2, 0: creado_por sale del token, siempre.
    r = validar_crear({"zona": "Miraflores", "reportes": [CIUDADANO],
                       "usuario_id": CIUDADANO, "creado_por": CIUDADANO})
    assert r["creado_por"] == OPERADOR


def test_crear_acepta_la_zona_como_clave_o_como_nombre():
    uno = str(uuid.uuid4())
    assert validar_crear({"zona": "MIRAFLORES", "reportes": [uno]})["zona"] == "MIRAFLORES"
    assert validar_crear({"zona_id": "MIRAFLORES", "reportes": [uno]})["zona"] == "MIRAFLORES"


def test_crear_deduplica_los_reportes_repetidos():
    uno = str(uuid.uuid4())
    r = validar_crear({"zona": "Miraflores", "reportes": [uno, uno, uno]})
    assert r["reportes_sql"] == "{" + uno + "}"


def validar_asignar(cuerpo):
    return ejecutar("Validar datos de la asignacion", [{}], nodos={
        "Webhook Asignar Operativo": [{"body": cuerpo}],
    })[0]


@pytest.mark.parametrize("cuerpo", [
    {},
    {"operativo_id": "no-es-uuid", "estado": "asignado", "cuadrilla_id": 1},
    {"operativo_id": str(uuid.uuid4())},                                  # sin estado
    {"operativo_id": str(uuid.uuid4()), "estado": "planificado"},         # no es destino
    {"operativo_id": str(uuid.uuid4()), "estado": "lo_que_sea"},
    {"operativo_id": str(uuid.uuid4()), "estado": "asignado"},            # falta cuadrilla
    {"operativo_id": str(uuid.uuid4()), "estado": "asignado", "cuadrilla_id": 0},
    {"operativo_id": str(uuid.uuid4()), "estado": "en_curso", "cuadrilla_id": "abc"},
    {"operativo_id": str(uuid.uuid4()), "estado": "cerrado", "cuadrilla_id": 1.5},
])
def test_asignar_sin_datos_validos_responde_400(cuerpo):
    assert validar_asignar(cuerpo) == {
        "valido": False, "http_code": 400, "error": "datos_invalidos"}


@pytest.mark.parametrize("estado", ["en_curso", "cerrado"])
def test_en_curso_y_cerrado_no_exigen_cuadrilla(estado):
    # La heredan del operativo; el CHECK de la base ya garantiza que la tiene.
    r = validar_asignar({"operativo_id": str(uuid.uuid4()), "estado": estado})
    assert r["valido"] is True and r["cuadrilla_id"] is None


def test_la_cuadrilla_llega_como_numero_aunque_venga_como_texto():
    r = validar_asignar({"operativo_id": str(uuid.uuid4()), "estado": "asignado",
                         "cuadrilla_id": "3"})
    assert r["cuadrilla_id"] == 3


# ---------------------------------------------------------------------------
# Nodos Code: armado de las respuestas
# ---------------------------------------------------------------------------

def test_un_reporte_no_disponible_responde_409_con_los_ids():
    malo = str(uuid.uuid4())
    r = ejecutar("Armar respuesta (crear)", [{"id": None, "no_disponibles": [malo]}])[0]
    assert r["creado"] is False and r["http_code"] == 409
    assert r["cuerpo"] == {"error": "reporte_no_disponible", "reportes": [malo]}


def test_el_operativo_creado_responde_201():
    oid = str(uuid.uuid4())
    r = ejecutar("Armar respuesta (crear)", [{
        "id": oid, "estado": "planificado", "zona_id": "MIRAFLORES",
        "reportes": 3, "no_disponibles": [],
    }])[0]
    assert r["http_code"] == 201
    assert r["cuerpo"] == {"id": oid, "estado": "planificado"}
    assert r["creado"] is True and r["reportes"] == 3


def test_el_evento_creado_usa_el_sobre_comun():
    oid, eid = str(uuid.uuid4()), str(uuid.uuid4())
    e = ejecutar("Armar evento operativo.creado", [{}], nodos={
        "Armar respuesta (crear)": [
            {"operativo_id": oid, "zona_id": "MIRAFLORES", "reportes": 4}],
        "Generar ID operativo.creado": [{"eventoId": eid}],
    })[0]
    assert e["id"] == eid and e["tipo"] == "operativo.creado"
    assert e["origen"] == "n8n/operativos"
    assert e["datos"] == {"operativo_id": oid, "zona_id": "MIRAFLORES", "reportes": 4}


FILA_ASIGNADA = {
    "existe": 1, "transicion_ok": 1, "cuadrilla_ok": 1, "estado_actual": "planificado",
    "reportes_resueltos": 0, "id": "11111111-1111-4111-8111-111111111111",
    "estado": "asignado", "cuadrilla_id": 1, "zona_id": "MIRAFLORES",
    "zona": "Miraflores", "cuadrilla": {"id": 1, "nombre": "Bacheo 1"}, "reportes": 5,
    "creado_en": "2026-10-20T10:00:00Z", "asignado_en": "2026-10-20T11:30:00Z",
    "cerrado_en": None, "horas_atencion": None,
}


def test_un_operativo_que_no_existe_responde_404():
    r = ejecutar("Armar respuesta (asignar)", [{
        "existe": 0, "transicion_ok": 0, "cuadrilla_ok": 1, "estado_actual": None}])[0]
    assert r["http_code"] == 404
    assert r["cuerpo"] == {"error": "operativo_no_encontrado"}


def test_una_cuadrilla_que_no_existe_responde_400():
    fila = {**FILA_ASIGNADA, "cuadrilla_ok": 0, "id": None}
    r = ejecutar("Armar respuesta (asignar)", [fila])[0]
    assert r["http_code"] == 400 and r["cuerpo"] == {"error": "datos_invalidos"}


def test_una_transicion_que_no_esta_en_la_tabla_responde_409():
    fila = {**FILA_ASIGNADA, "transicion_ok": 0, "estado_actual": "cerrado", "id": None}
    r = ejecutar("Armar respuesta (asignar)", [fila])[0]
    assert r["http_code"] == 409
    assert r["cuerpo"] == {"error": "transicion_invalida", "estado_actual": "cerrado"}


def test_la_asignacion_responde_200_con_el_formato_de_la_lista():
    r = ejecutar("Armar respuesta (asignar)", [FILA_ASIGNADA])[0]
    assert r["http_code"] == 200 and r["cerrado"] is False
    assert r["cuerpo"] == {
        "id": FILA_ASIGNADA["id"], "zona": "Miraflores", "zona_id": "MIRAFLORES",
        "estado": "asignado", "cuadrilla": {"id": 1, "nombre": "Bacheo 1"},
        "reportes": 5, "creado_en": "2026-10-20T10:00:00Z",
        "asignado_en": "2026-10-20T11:30:00Z", "cerrado_en": None,
    }


def test_el_cierre_marca_cerrado_y_el_evento_lleva_las_horas():
    fila = {**FILA_ASIGNADA, "estado": "cerrado", "estado_actual": "en_curso",
            "cerrado_en": "2026-10-21T12:30:00Z", "horas_atencion": "26.5",
            "reportes_resueltos": 5}
    r = ejecutar("Armar respuesta (asignar)", [fila])[0]
    assert r["cerrado"] is True and r["horas_atencion"] == 26.5

    eid = str(uuid.uuid4())
    e = ejecutar("Armar evento operativo.cerrado", [{}], nodos={
        "Armar respuesta (asignar)": [r],
        "Generar ID operativo.cerrado": [{"eventoId": eid}],
    })[0]
    assert e["tipo"] == "operativo.cerrado"
    assert e["datos"] == {
        "operativo_id": FILA_ASIGNADA["id"], "zona_id": "MIRAFLORES",
        "cuadrilla_id": 1, "reportes": 5, "horas_atencion": 26.5,
    }


def test_un_cierre_inmediato_publica_cero_horas_no_un_nulo():
    # horas_atencion = 0 es un numero valido: el validador del enrutador lo
    # comprueba con esNumero, no con un truthy.
    fila = {**FILA_ASIGNADA, "estado": "cerrado", "estado_actual": "asignado",
            "cerrado_en": "2026-10-20T10:00:00Z", "horas_atencion": "0.0"}
    r = ejecutar("Armar respuesta (asignar)", [fila])[0]
    assert r["horas_atencion"] == 0


def test_la_lista_de_zonas_sale_vacia_sin_filas():
    # alwaysOutputData deja pasar un item vacio cuando no hay ninguna fila.
    r = ejecutar("Armar respuesta por zona", [{}])[0]
    assert r == {"http_code": 200, "cuerpo": []}


def test_la_lista_de_operativos_normaliza_los_nulos():
    r = ejecutar("Armar lista de operativos", [{
        "id": "11111111-1111-4111-8111-111111111111", "zona_id": "SIN_DISTRITO",
        "zona": "Sin distrito", "estado": "planificado", "cuadrilla": None,
        "reportes": 2, "creado_en": "2026-10-20T10:00:00Z",
        "asignado_en": None, "cerrado_en": None,
    }])[0]
    fila = r["cuerpo"][0]
    assert fila["cuadrilla"] is None
    assert fila["asignado_en"] is None and fila["cerrado_en"] is None


# ---------------------------------------------------------------------------
# Consultas SQL contra Postgres
# ---------------------------------------------------------------------------

psycopg = pytest.importorskip("psycopg")

ZONAS = consulta("Incidentes por zona")
CREAR = consulta("Crear operativo")
LISTAR = consulta("Listar operativos")
CUADRILLAS = consulta("Cuadrillas activas")
ASIGNAR = consulta("Aplicar cambio de estado")

# Un siniestro georreferenciado por distrito: distrito_de_reporte() busca el
# mas cercano a menos de 3 km, asi que es lo que fija la zona de un reporte.
SINIESTROS = [
    ("S-MIR", "MIRAFLORES", -12.1211, -77.0297),
    ("S-SUR", "SANTIAGO DE SURCO", -12.1450, -76.9900),
]
# Lejos de cualquier siniestro: el reporte se queda en SIN_DISTRITO.
LEJOS = (-12.5000, -76.5000)


@pytest.fixture
def conn(dsn):
    with psycopg.connect(dsn) as c:
        yield c
        c.rollback()


@pytest.fixture
def base(conn):
    """Siembra operador, ciudadano, siniestros y deja la transaccion abierta."""
    with psycopg.RawCursor(conn) as cur:
        cur.execute("TRUNCATE operativo_reportes, operativos, siniestros_fatales")
        cur.execute("DELETE FROM reports")
        for codigo, distrito, lat, lon in SINIESTROS:
            cur.execute(
                "INSERT INTO siniestros_fatales (codigo_siniestro, fecha_iso,"
                " hora_siniestro, clase_siniestro, fallecidos, lesionados,"
                " departamento, provincia, distrito, latitud, longitud, geom)"
                " VALUES ($1, '2025-03-10', '14:20', 'CHOQUE', 1, 0, 'LIMA', 'LIMA',"
                " $2, $3, $4, ST_SetSRID(ST_MakePoint($4, $3), 4326))",
                (codigo, distrito, lat, lon),
            )
        for uid, rol in ((OPERADOR, "operador"), (CIUDADANO, "ciudadano")):
            cur.execute(
                "INSERT INTO usuarios (id, username, email, password_hash,"
                " password_salt, role) VALUES ($1, $2, $3, 'x', 'x', $4)"
                " ON CONFLICT (id) DO NOTHING",
                (uid, "u" + uid[:8], uid[:8] + "@urbanpulse.pe", rol),
            )
    return conn


def reporte(cur, zona="MIRAFLORES", status="pending", tipo="bache", severidad="alta"):
    rid = str(uuid.uuid4())
    lat, lon = LEJOS
    for _, distrito, la, lo in SINIESTROS:
        if distrito == zona:
            lat, lon = la, lo
    cur.execute(
        "INSERT INTO reports (id, description, incident_type, severity, latitude,"
        " longitude, status, usuario_id) VALUES ($1, 'x', $2, $3, $4, $5, $6, $7)",
        (rid, tipo, severidad, lat, lon, status, CIUDADANO),
    )
    return rid


def arreglo(ids):
    return "{" + ",".join(ids) + "}"


def una_fila(cur):
    fila = dict(zip([d.name for d in cur.description], cur.fetchone()))
    if fila.get("id") is not None:
        fila["id"] = str(fila["id"])
    return fila


def crear(cur, zona, ids, usuario=OPERADOR):
    cur.execute(CREAR, (zona, arreglo(ids), usuario))
    return una_fila(cur)


def asignar(cur, operativo_id, estado, cuadrilla_id=None):
    cur.execute(ASIGNAR, (operativo_id, estado, cuadrilla_id))
    return una_fila(cur)


def filas(cur, sql, params=None):
    cur.execute(sql, params) if params else cur.execute(sql)
    cols = [d.name for d in cur.description]
    return [dict(zip(cols, f)) for f in cur.fetchall()]


# --- GET /incidentes-por-zona ----------------------------------------------

def test_los_incidentes_se_agrupan_por_zona_y_ordenan_por_total(base):
    with psycopg.RawCursor(base) as cur:
        for _ in range(3):
            reporte(cur, "MIRAFLORES")
        reporte(cur, "SANTIAGO DE SURCO")
        reporte(cur, "MIRAFLORES", status="en_proceso")
        reporte(cur, "MIRAFLORES", status="resuelto")   # cerrado: no entra
        zonas = filas(cur, ZONAS)

    assert [(z["zona_id"], z["total"]) for z in zonas] == [
        ("MIRAFLORES", 4), ("SANTIAGO DE SURCO", 1)]
    assert zonas[0]["zona"] == "Miraflores"
    uno = zonas[0]["incidentes"][0]
    assert set(uno) == {"id", "tipo", "severidad", "creado"}
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", uno["creado"])


def test_un_reporte_sin_distrito_cercano_cae_en_sin_distrito(base):
    with psycopg.RawCursor(base) as cur:
        reporte(cur, "NINGUNA")
        zonas = filas(cur, ZONAS)
    assert [(z["zona_id"], z["zona"]) for z in zonas] == [
        ("SIN_DISTRITO", "Sin distrito")]


def test_un_reporte_ya_en_un_operativo_abierto_no_vuelve_a_la_bandeja(base):
    with psycopg.RawCursor(base) as cur:
        tomado = reporte(cur, "MIRAFLORES")
        libre = reporte(cur, "MIRAFLORES")
        crear(cur, "MIRAFLORES", [tomado])
        zonas = filas(cur, ZONAS)

    assert zonas[0]["total"] == 1
    assert [i["id"] for i in zonas[0]["incidentes"]] == [libre]


def test_al_cerrar_el_operativo_sus_reportes_salen_de_la_bandeja(base):
    with psycopg.RawCursor(base) as cur:
        rid = reporte(cur, "MIRAFLORES")
        op = crear(cur, "MIRAFLORES", [rid])
        asignar(cur, op["id"], "asignado", 1)
        asignar(cur, op["id"], "cerrado")
        # Ya no esta en un operativo abierto, pero quedo resuelto.
        assert filas(cur, ZONAS) == []


# --- POST /operativos ------------------------------------------------------

def test_crear_un_operativo_lo_deja_planificado_con_sus_reportes(base):
    with psycopg.RawCursor(base) as cur:
        ids = [reporte(cur, "MIRAFLORES") for _ in range(3)]
        op = crear(cur, "Miraflores", ids)

        assert op["estado"] == "planificado"
        assert op["zona_id"] == "MIRAFLORES"
        assert op["reportes"] == 3
        assert op["no_disponibles"] == []
        adjuntos = filas(
            cur, "SELECT reporte_id FROM operativo_reportes WHERE operativo_id = $1",
            (op["id"],))
        assert {str(a["reporte_id"]) for a in adjuntos} == set(ids)
        duenio = filas(cur, "SELECT creado_por FROM operativos WHERE id = $1",
                       (op["id"],))
        assert str(duenio[0]["creado_por"]) == OPERADOR


@pytest.mark.parametrize("zona", ["MIRAFLORES", "Miraflores", "miraflores"])
def test_la_zona_entra_como_clave_o_como_nombre(base, zona):
    with psycopg.RawCursor(base) as cur:
        op = crear(cur, zona, [reporte(cur, "MIRAFLORES")])
    assert op["zona_id"] == "MIRAFLORES"


def test_una_variante_del_distrito_tambien_vale(base):
    # distritos_lima guarda SURCO como variante de SANTIAGO DE SURCO.
    with psycopg.RawCursor(base) as cur:
        op = crear(cur, "Surco", [reporte(cur, "SANTIAGO DE SURCO")])
    assert op["zona_id"] == "SANTIAGO DE SURCO"


@pytest.mark.parametrize("zona", ["SIN_DISTRITO", "Sin distrito"])
def test_los_reportes_sin_distrito_forman_un_operativo(base, zona):
    with psycopg.RawCursor(base) as cur:
        op = crear(cur, zona, [reporte(cur, "NINGUNA")])
    assert op["zona_id"] == "SIN_DISTRITO" and op["reportes"] == 1


def test_un_reporte_de_otra_zona_bloquea_la_creacion_entera(base):
    with psycopg.RawCursor(base) as cur:
        bueno = reporte(cur, "MIRAFLORES")
        ajeno = reporte(cur, "SANTIAGO DE SURCO")
        op = crear(cur, "MIRAFLORES", [bueno, ajeno])

        assert op["id"] is None
        assert [str(x) for x in op["no_disponibles"]] == [ajeno]
        # Y no quedo nada a medias.
        assert filas(cur, "SELECT id FROM operativos") == []
        assert filas(cur, "SELECT reporte_id FROM operativo_reportes") == []


@pytest.mark.parametrize("estado", ["resuelto"])
def test_un_reporte_cerrado_no_se_puede_agrupar(base, estado):
    with psycopg.RawCursor(base) as cur:
        malo = reporte(cur, "MIRAFLORES", status=estado)
        op = crear(cur, "MIRAFLORES", [malo])
    assert op["id"] is None and [str(x) for x in op["no_disponibles"]] == [malo]


def test_un_reporte_inexistente_no_se_puede_agrupar(base):
    fantasma = str(uuid.uuid4())
    with psycopg.RawCursor(base) as cur:
        op = crear(cur, "MIRAFLORES", [fantasma])
    assert op["id"] is None and [str(x) for x in op["no_disponibles"]] == [fantasma]


def test_un_reporte_no_puede_estar_en_dos_operativos_abiertos(base):
    with psycopg.RawCursor(base) as cur:
        rid = reporte(cur, "MIRAFLORES")
        primero = crear(cur, "MIRAFLORES", [rid])
        segundo = crear(cur, "MIRAFLORES", [rid])

    assert primero["id"] is not None
    assert segundo["id"] is None
    assert [str(x) for x in segundo["no_disponibles"]] == [rid]


def test_una_zona_que_no_existe_no_crea_nada(base):
    with psycopg.RawCursor(base) as cur:
        rid = reporte(cur, "MIRAFLORES")
        op = crear(cur, "Chiclayo", [rid])
        assert op["id"] is None
        assert [str(x) for x in op["no_disponibles"]] == [rid]
        assert filas(cur, "SELECT id FROM operativos") == []


# --- GET /operativos y /cuadrillas -----------------------------------------

def test_la_lista_sale_del_mas_reciente_al_mas_antiguo_y_filtra_por_estado(base):
    with psycopg.RawCursor(base) as cur:
        viejo = crear(cur, "MIRAFLORES", [reporte(cur, "MIRAFLORES")])
        nuevo = crear(cur, "SANTIAGO DE SURCO", [reporte(cur, "SANTIAGO DE SURCO")])
        asignar(cur, nuevo["id"], "asignado", 2)
        # now() es el instante de la transaccion, asi que dentro de una misma
        # prueba los dos operativos empatan: hay que separarlos a mano. En
        # produccion cada peticion es su propia transaccion.
        cur.execute("UPDATE operativos SET creado_en = now() - INTERVAL '1 hour'"
                    " WHERE id = $1", (viejo["id"],))

        todos = filas(cur, LISTAR, (None,))
        assert [str(o["id"]) for o in todos] == [nuevo["id"], viejo["id"]]

        solo = filas(cur, LISTAR, ("asignado",))
        assert [str(o["id"]) for o in solo] == [nuevo["id"]]
        assert solo[0]["cuadrilla"] == {"id": 2, "nombre": "Señalización 1"}
        assert solo[0]["reportes"] == 1
        assert solo[0]["asignado_en"] is not None and solo[0]["cerrado_en"] is None

        planificado = next(o for o in todos if str(o["id"]) == viejo["id"])
        assert planificado["cuadrilla"] is None
        assert planificado["asignado_en"] is None


def test_la_lista_trae_el_nombre_para_mostrar_y_la_clave(base):
    with psycopg.RawCursor(base) as cur:
        crear(cur, "MIRAFLORES", [reporte(cur, "MIRAFLORES")])
        crear(cur, "SIN_DISTRITO", [reporte(cur, "NINGUNA")])
        zonas = {(o["zona_id"], o["zona"]) for o in filas(cur, LISTAR, (None,))}
    assert zonas == {("MIRAFLORES", "Miraflores"), ("SIN_DISTRITO", "Sin distrito")}


def test_las_cuadrillas_activas_son_las_del_seeder(base):
    with psycopg.RawCursor(base) as cur:
        cuadrillas = filas(cur, CUADRILLAS)
    assert [(c["id"], c["nombre"], c["especialidad"]) for c in cuadrillas] == [
        (1, "Bacheo 1", "bacheo"),
        (2, "Señalización 1", "senalizacion"),
        (3, "Semáforos 1", "semaforos"),
        (4, "Limpieza 1", "limpieza"),
    ]


def test_una_cuadrilla_inactiva_no_sale_en_el_selector(base):
    with psycopg.RawCursor(base) as cur:
        cur.execute("UPDATE cuadrillas SET activa = FALSE WHERE id = 1")
        cuadrillas = filas(cur, CUADRILLAS)
    assert 1 not in [c["id"] for c in cuadrillas]


# --- POST /operativos/asignar ----------------------------------------------

def test_el_ciclo_completo_crear_asignar_en_curso_cerrar(base):
    with psycopg.RawCursor(base) as cur:
        ids = [reporte(cur, "MIRAFLORES") for _ in range(2)]
        op = crear(cur, "MIRAFLORES", ids)

        a = asignar(cur, op["id"], "asignado", 1)
        assert a["existe"] == 1 and a["transicion_ok"] == 1 and a["cuadrilla_ok"] == 1
        assert a["estado"] == "asignado"
        assert a["cuadrilla"] == {"id": 1, "nombre": "Bacheo 1"}
        assert a["asignado_en"] is not None and a["cerrado_en"] is None
        primera_asignacion = a["asignado_en"]

        c = asignar(cur, op["id"], "en_curso")
        assert c["estado"] == "en_curso"
        assert c["cuadrilla"] == {"id": 1, "nombre": "Bacheo 1"}
        assert c["asignado_en"] == primera_asignacion

        z = asignar(cur, op["id"], "cerrado")
        assert z["estado"] == "cerrado"
        assert z["cerrado_en"] is not None
        assert z["reportes_resueltos"] == 2
        assert z["reportes"] == 2
        assert float(z["horas_atencion"]) == 0.0

        resueltos = filas(
            cur, "SELECT status, resolved_at FROM reports WHERE id = ANY($1::UUID[])",
            (arreglo(ids),))
        assert {r["status"] for r in resueltos} == {"resuelto"}
        assert all(r["resolved_at"] is not None for r in resueltos)


def test_reasignar_cambia_la_cuadrilla_pero_no_asignado_en(base):
    with psycopg.RawCursor(base) as cur:
        op = crear(cur, "MIRAFLORES", [reporte(cur, "MIRAFLORES")])
        primera = asignar(cur, op["id"], "asignado", 1)
        segunda = asignar(cur, op["id"], "asignado", 3)

    assert segunda["cuadrilla"] == {"id": 3, "nombre": "Semáforos 1"}
    assert segunda["asignado_en"] == primera["asignado_en"]


def test_un_operativo_que_no_existe_no_cambia_nada(base):
    with psycopg.RawCursor(base) as cur:
        r = asignar(cur, str(uuid.uuid4()), "asignado", 1)
    assert r["existe"] == 0 and r["id"] is None


@pytest.mark.parametrize("desde, pedido", [
    ("planificado", "en_curso"),    # hay que asignar primero
    ("planificado", "cerrado"),     # idem
    ("cerrado", "asignado"),        # reabrir un cerrado no esta en la tabla
    ("cerrado", "en_curso"),
    ("cerrado", "cerrado"),
])
def test_las_transiciones_fuera_de_la_tabla_no_se_aplican(base, desde, pedido):
    with psycopg.RawCursor(base) as cur:
        op = crear(cur, "MIRAFLORES", [reporte(cur, "MIRAFLORES")])
        if desde != "planificado":
            asignar(cur, op["id"], "asignado", 1)
            asignar(cur, op["id"], desde)

        r = asignar(cur, op["id"], pedido, 1 if pedido == "asignado" else None)
        assert r["existe"] == 1 and r["transicion_ok"] == 0 and r["id"] is None
        assert r["estado_actual"] == desde
        # El operativo quedo como estaba.
        actual = filas(cur, "SELECT estado FROM operativos WHERE id = $1", (op["id"],))
        assert actual[0]["estado"] == desde


@pytest.mark.parametrize("cuadrilla_id", [99, 1])
def test_una_cuadrilla_inexistente_o_inactiva_no_aplica_el_cambio(base, cuadrilla_id):
    with psycopg.RawCursor(base) as cur:
        cur.execute("UPDATE cuadrillas SET activa = FALSE WHERE id = 1")
        op = crear(cur, "MIRAFLORES", [reporte(cur, "MIRAFLORES")])
        r = asignar(cur, op["id"], "asignado", cuadrilla_id)

        assert r["cuadrilla_ok"] == 0 and r["id"] is None
        actual = filas(cur, "SELECT estado, cuadrilla_id FROM operativos WHERE id = $1",
                       (op["id"],))
        assert actual[0] == {"estado": "planificado", "cuadrilla_id": None}


def test_cerrar_no_vuelve_a_tocar_un_reporte_ya_resuelto(base):
    with psycopg.RawCursor(base) as cur:
        ids = [reporte(cur, "MIRAFLORES") for _ in range(2)]
        op = crear(cur, "MIRAFLORES", ids)
        asignar(cur, op["id"], "asignado", 1)
        # Alguien resolvio uno por su cuenta (por ejemplo /report-resolve).
        cur.execute("UPDATE reports SET status = 'resuelto', resolved_at = now()"
                    " WHERE id = $1", (ids[0],))

        r = asignar(cur, op["id"], "cerrado")
        assert r["estado"] == "cerrado"
        assert r["reportes_resueltos"] == 1   # solo el que faltaba
        assert r["reportes"] == 2             # pero el operativo tiene los dos
