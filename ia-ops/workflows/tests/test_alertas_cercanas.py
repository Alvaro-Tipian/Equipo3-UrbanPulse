"""Suscriptor de alertas cercanas (HU-10 T02, contrato C3 de docs/ALERTAS_CONTRACT.md).

Tres clases de prueba, igual que el resto del arnes:

- La estructura del workflow y su suscripcion en el despachador de eventos.
- Los nodos Code se ejecutan de verdad en Node.js con ejecutar_nodo.mjs, con la
  misma entrada que les da n8n.
- La consulta SQL se ejecuta tal cual esta en el workflow contra un Postgres con
  PostGIS y todas las migraciones. Cada prueba corre en una transaccion que se
  revierte al final, asi que no deja filas ni en Neon.

  TEST_DATABASE_URL=postgresql://usuario:clave@host:5432/urbanpulse_db pytest

Los dos ciudadanos de prueba del criterio de aceptacion (300 m y 700 m) se
siembran con ST_Project sobre el punto del reporte, para que la distancia sea
exacta y no dependa de coordenadas escritas a mano.
"""

import json
import subprocess
import uuid
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[3]
WORKFLOW = RAIZ / "ia-ops" / "workflows" / "n8n_alertas_cercanas.json"
PRODUCCION = RAIZ / "src" / "n8n-workflows" / "production" / "urbanpulse-alertas-cercanas.json"
DESPACHADOR = RAIZ / "ia-ops" / "workflows" / "n8n_despachar_evento.json"
HARNESS = Path(__file__).with_name("ejecutar_nodo.mjs")

WF = json.loads(WORKFLOW.read_text(encoding="utf-8"))
NODOS = {n["name"]: n for n in WF["nodes"]}
NODO_SUSCRIPTOR = "Call 'UrbanPulse - Alertas cercanas (HU-10 T02)'"

# Punto del reporte critico de prueba (Miraflores, el mismo de los otros arneses).
LAT, LON = -12.1211, -77.0297

REPORTE_CRITICO = str(uuid.uuid4())
REPORTE_MEDIO = str(uuid.uuid4())
REPORTE_SIN_COORDENADAS = str(uuid.uuid4())

AUTOR = str(uuid.uuid4())
CERCA = str(uuid.uuid4())
LEJOS = str(uuid.uuid4())
OPERADOR = str(uuid.uuid4())
UBICACION_VIEJA = str(uuid.uuid4())
SIN_UBICACION = str(uuid.uuid4())

# (id, role, metros desde el reporte, horas de antiguedad de la ubicacion)
VECINOS = [
    (AUTOR, "ciudadano", 100, 1),
    (CERCA, "ciudadano", 300, 1),
    (LEJOS, "ciudadano", 700, 1),
    (OPERADOR, "operador", 200, 1),
    (UBICACION_VIEJA, "ciudadano", 250, 25),
    (SIN_UBICACION, "ciudadano", None, None),
]


def ejecutar(nodo, entrada, nodos=None):
    """Corre el jsCode del nodo en Node.js, como lo haria n8n."""
    proc = subprocess.run(
        ["node", str(HARNESS), str(WORKFLOW), nodo],
        input=json.dumps({"entrada": entrada, "nodos": nodos or {}}, default=str),
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stdout or proc.stderr
    return json.loads(proc.stdout)


def ejecutar_con_error(nodo, entrada, nodos=None):
    """Igual que ejecutar(), pero para los casos en que el nodo debe fallar."""
    proc = subprocess.run(
        ["node", str(HARNESS), str(WORKFLOW), nodo],
        input=json.dumps({"entrada": entrada, "nodos": nodos or {}}, default=str),
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode != 0, "el nodo no fallo: " + proc.stdout
    return json.loads(proc.stdout)["error"]


def sobre(tipo="reporte.creado", datos=None):
    """Sobre de evento del contrato del enrutador (HT-51 T02, seccion 1)."""
    return {
        "id": str(uuid.uuid4()),
        "tipo": tipo,
        "fecha": "2026-10-30T01:02:11-05:00",
        "origen": "n8n/central-vr5",
        "datos": {"reporte_id": REPORTE_CRITICO} if datos is None else datos,
    }


# ---------------------------------------------------------------------------
# Estructura del workflow
# ---------------------------------------------------------------------------

def test_es_un_suscriptor_del_despachador():
    # El despachador lo llama con Execute Workflow, no por webhook.
    trigger = NODOS["Recibir Evento"]
    assert trigger["type"] == "n8n-nodes-base.executeWorkflowTrigger"
    assert trigger["parameters"]["inputSource"] == "passthrough"


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
    sueltos = [n["name"] for n in WF["nodes"] if n["name"] not in destinos]
    assert sueltos == ["Recibir Evento"]


def test_la_consulta_respeta_las_reglas_del_contrato_c3():
    sql = NODOS["Registrar alertas cercanas"]["parameters"]["query"]
    assert "ST_DWithin(u.ultima_ubicacion, p.punto, 500)" in sql     # radio 500 m
    assert "interval '24 hours'" in sql                               # ubicaciones de 24 h
    assert "u.role = 'ciudadano'" in sql                              # solo ciudadanos
    assert "u.id IS DISTINCT FROM r.usuario_id" in sql                # no al autor
    assert "r.severity = 'alta'" in sql                               # critico = alta (0.1)
    assert "ON CONFLICT (reporte_id, usuario_id) DO NOTHING" in sql   # entrega al menos una vez


def test_el_nodo_postgres_siempre_devuelve_un_item():
    # Sin alwaysOutputData, un reporte critico sin nadie cerca corta el flujo y
    # el suscriptor no responde nada al despachador.
    assert NODOS["Registrar alertas cercanas"]["alwaysOutputData"] is True


def test_el_despachador_lo_llama_en_paralelo_a_la_ingesta_rag():
    desp = json.loads(DESPACHADOR.read_text(encoding="utf-8"))
    nodos = {n["name"]: n for n in desp["nodes"]}
    assert NODO_SUSCRIPTOR in nodos

    # Las alertas no esperan al pipeline del RAG: salen de la misma salida del IF.
    rama_reportes = [d["node"] for d in desp["connections"]["¿Es evento de reporte?"]["main"][0]]
    assert NODO_SUSCRIPTOR in rama_reportes
    assert "Call 'UrbanPulse - Ingesta RAG conocimiento vial (HT-50 T01)'" in rama_reportes

    # Un fallo del suscriptor deja el evento fallido para el reproceso (ADR-015).
    assert nodos[NODO_SUSCRIPTOR]["onError"] == "continueErrorOutput"
    salidas = desp["connections"][NODO_SUSCRIPTOR]["main"]
    assert salidas[0][0]["node"] == "Marcar Evento Entregado"
    assert salidas[1][0]["node"] == "Marcar Evento Fallido"


# ---------------------------------------------------------------------------
# Nodos Code
# ---------------------------------------------------------------------------

def test_validar_evento_saca_el_reporte_id_del_sobre():
    evento = sobre()
    salida = ejecutar("Validar evento", [evento])
    assert salida == [{"evento_id": evento["id"], "reporte_id": REPORTE_CRITICO}]


@pytest.mark.parametrize("datos", [
    {},                                   # sin reporte_id
    {"reporte_id": None},
    {"reporte_id": 42},                   # reports.id es UUID, no un entero
    {"reporte_id": "no-es-un-uuid"},
])
def test_validar_evento_rechaza_un_reporte_id_que_no_es_uuid(datos):
    error = ejecutar_con_error("Validar evento", [sobre(datos=datos)])
    assert "reporte_id" in error


def test_un_evento_de_otro_tipo_no_consulta_nada():
    salida = ejecutar("Evento ignorado", [sobre(tipo="reporte.estado_cambiado")])
    assert salida[0]["alertas_creadas"] == 0
    assert salida[0]["motivo"] == "tipo_no_aplicable"
    assert salida[0]["tipo"] == "reporte.estado_cambiado"


def test_el_resumen_cuenta_las_alertas_insertadas():
    salida = ejecutar(
        "Resumen de alertas",
        [{"usuario_id": CERCA, "distancia_m": 300}, {"usuario_id": LEJOS, "distancia_m": 480}],
        nodos={"Validar evento": [{"reporte_id": REPORTE_CRITICO}]},
    )
    assert salida == [{
        "reporte_id": REPORTE_CRITICO,
        "alertas_creadas": 2,
        "distancias_m": [300, 480],
    }]


def test_el_resumen_informa_cero_cuando_no_hay_nadie_cerca():
    # Lo que entrega el nodo Postgres con alwaysOutputData y cero filas.
    salida = ejecutar(
        "Resumen de alertas",
        [{}],
        nodos={"Validar evento": [{"reporte_id": REPORTE_CRITICO}]},
    )
    assert salida == [{
        "reporte_id": REPORTE_CRITICO,
        "alertas_creadas": 0,
        "distancias_m": [],
    }]


# ---------------------------------------------------------------------------
# La consulta del workflow contra Postgres (PostGIS)
# ---------------------------------------------------------------------------

try:
    import psycopg
except ModuleNotFoundError:  # pragma: no cover
    psycopg = None

# Un importorskip a nivel de modulo saltaria tambien las pruebas de arriba, que
# no necesitan base de datos.
requiere_bd = pytest.mark.skipif(
    psycopg is None, reason="falta psycopg (pip install 'psycopg[binary]')"
)

INSERTAR = NODOS["Registrar alertas cercanas"]["parameters"]["query"]


@pytest.fixture
def conn(dsn):
    with psycopg.connect(dsn) as c:
        yield c
        c.rollback()


@pytest.fixture
def base(conn):
    """Siembra los vecinos y los reportes de prueba; la transaccion se revierte."""
    with psycopg.RawCursor(conn) as cur:
        for uid, rol, metros, horas in VECINOS:
            cur.execute(
                "INSERT INTO usuarios (id, username, email, password_hash,"
                " password_salt, role, ultima_ubicacion, ubicacion_actualizada_en)"
                " VALUES ($1, $2, $3, 'x', 'x', $4,"
                "   CASE WHEN $5::float8 IS NULL THEN NULL ELSE"
                "     ST_Project(ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,"
                "                $5::float8, radians(0)) END,"
                "   CASE WHEN $8::float8 IS NULL THEN NULL ELSE"
                "     now() - make_interval(hours => $8::int) END)",
                (uid, "u" + uid[:8], uid[:8] + "@urbanpulse.pe", rol,
                 metros, LON, LAT, horas),
            )
        reportes = [
            (REPORTE_CRITICO, "alta", LAT, LON),
            (REPORTE_MEDIO, "media", LAT, LON),
            (REPORTE_SIN_COORDENADAS, "alta", None, None),
        ]
        for rid, severidad, lat, lon in reportes:
            cur.execute(
                "INSERT INTO reports (id, description, incident_type, severity,"
                " latitude, longitude, status, usuario_id)"
                " VALUES ($1, 'Reporte de prueba HU-10 T02', 'infraestructura_vial',"
                " $2, $3, $4, 'pending', $5)",
                (rid, severidad, lat, lon, AUTOR),
            )
    return conn


def registrar(conn, reporte_id):
    """Ejecuta la consulta del workflow y devuelve sus filas."""
    with psycopg.RawCursor(conn) as cur:
        cur.execute(INSERTAR, (reporte_id,))
        return cur.fetchall()


@requiere_bd
def test_solo_el_ciudadano_a_300_m_recibe_la_alerta(base):
    filas = registrar(base, REPORTE_CRITICO)

    assert len(filas) == 1, filas
    usuario_id, distancia = filas[0]
    assert str(usuario_id) == CERCA
    assert 295 <= distancia <= 305


@pytest.mark.parametrize("uid, por_que", [
    (LEJOS, "esta a 700 m, fuera del radio de 500 m"),
    (AUTOR, "es el autor del reporte"),
    (OPERADOR, "no tiene role = ciudadano"),
    (UBICACION_VIEJA, "su ubicacion tiene mas de 24 h"),
    (SIN_UBICACION, "nunca compartio su ubicacion"),
])
@requiere_bd
def test_no_reciben_alerta(base, uid, por_que):
    avisados = {str(f[0]) for f in registrar(base, REPORTE_CRITICO)}
    assert uid not in avisados, por_que


@requiere_bd
def test_un_evento_repetido_no_duplica_la_alerta(base):
    # El enrutador entrega al menos una vez (ADR-015).
    primera = registrar(base, REPORTE_CRITICO)
    segunda = registrar(base, REPORTE_CRITICO)

    assert len(primera) == 1
    assert segunda == []
    with psycopg.RawCursor(base) as cur:
        cur.execute(
            "SELECT count(*) FROM alertas_ciudadano WHERE reporte_id = $1::uuid",
            (REPORTE_CRITICO,),
        )
        assert cur.fetchone()[0] == 1


@requiere_bd
def test_un_reporte_no_critico_no_genera_alertas(base):
    assert registrar(base, REPORTE_MEDIO) == []


@requiere_bd
def test_un_reporte_sin_coordenadas_no_genera_alertas(base):
    assert registrar(base, REPORTE_SIN_COORDENADAS) == []


@pytest.mark.parametrize("horas, recibe", [(23, True), (25, False)])
@requiere_bd
def test_la_ventana_de_la_ubicacion_es_de_24_h(base, horas, recibe):
    with psycopg.RawCursor(base) as cur:
        cur.execute(
            "UPDATE usuarios SET ubicacion_actualizada_en = now() -"
            " make_interval(hours => $2::int) WHERE id = $1::uuid",
            (UBICACION_VIEJA, horas),
        )
    avisados = {str(f[0]) for f in registrar(base, REPORTE_CRITICO)}
    assert (UBICACION_VIEJA in avisados) is recibe


@requiere_bd
def test_la_alerta_queda_pendiente_con_su_distancia(base):
    registrar(base, REPORTE_CRITICO)

    with psycopg.RawCursor(base) as cur:
        cur.execute(
            "SELECT usuario_id, distancia_m, descartada_en FROM alertas_ciudadano"
            " WHERE reporte_id = $1::uuid",
            (REPORTE_CRITICO,),
        )
        usuario_id, distancia, descartada = cur.fetchone()

    # Lo que HU-10 T03 lee en GET /urbanpulse/alertas: pendiente (descartada_en NULL).
    assert str(usuario_id) == CERCA
    assert 295 <= distancia <= 305
    assert descartada is None
