"""Webhooks de alertas del ciudadano (HU-10 T03, contrato C3 de docs/ALERTAS_CONTRACT.md).

Tres clases de prueba, igual que el resto del arnes:

- La estructura del workflow: rutas, CORS, nodos de respuesta y de donde sale
  el usuario (siempre del token, nunca del cuerpo ni de la URL).
- Los nodos Code se ejecutan de verdad en Node.js con ejecutar_nodo.mjs, con la
  misma entrada que les da n8n.
- Las consultas SQL se ejecutan tal cual estan en el workflow contra un Postgres
  con PostGIS y todas las migraciones. Cada prueba corre en una transaccion que
  se revierte al final.

  TEST_DATABASE_URL=postgresql://usuario:clave@host:5432/urbanpulse_db pytest

La validacion del token en si la cubre tests/test_validar_token.py, que compara
las tres copias en linea de este workflow contra el subworkflow de HT-36 T01.
"""

import json
import subprocess
import uuid
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[3]
WORKFLOW = RAIZ / "ia-ops" / "workflows" / "n8n_alertas.json"
PRODUCCION = RAIZ / "src" / "n8n-workflows" / "production" / "urbanpulse-alertas.json"
HARNESS = Path(__file__).with_name("ejecutar_nodo.mjs")

WF = json.loads(WORKFLOW.read_text(encoding="utf-8"))
NODOS = {n["name"]: n for n in WF["nodes"]}

RUTAS_ESPERADAS = {
    ("urbanpulse/alertas", "GET"),
    ("urbanpulse/alertas/descartar", "POST"),
    ("urbanpulse/ubicacion", "POST"),
}

CIUDADANO = str(uuid.uuid4())
OTRO_CIUDADANO = str(uuid.uuid4())
REPORTE = str(uuid.uuid4())
REPORTE_ANTERIOR = str(uuid.uuid4())
ALERTA_RECIENTE = str(uuid.uuid4())
ALERTA_VIEJA = str(uuid.uuid4())
ALERTA_AJENA = str(uuid.uuid4())

LAT, LON = -12.1211, -77.0297


def ejecutar(nodo, entrada, nodos=None):
    """Corre el jsCode del nodo en Node.js, como lo haria n8n."""
    proc = subprocess.run(
        ["node", str(HARNESS), str(WORKFLOW), nodo],
        input=json.dumps({"entrada": entrada, "nodos": nodos or {}}, default=str),
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stdout or proc.stderr
    return json.loads(proc.stdout)


def consulta(nodo):
    return NODOS[nodo]["parameters"]["query"]


# ---------------------------------------------------------------------------
# Estructura del workflow
# ---------------------------------------------------------------------------

def test_estan_los_tres_webhooks_del_contrato():
    rutas = {
        (n["parameters"]["path"], n["parameters"].get("httpMethod", "GET"))
        for n in WF["nodes"] if n["type"] == "n8n-nodes-base.webhook"
    }
    assert rutas == RUTAS_ESPERADAS


@pytest.mark.parametrize("nodo", [
    n["name"] for n in WF["nodes"] if n["type"] == "n8n-nodes-base.webhook"
])
def test_cada_webhook_responde_con_un_nodo_respond(nodo):
    # Sin responseNode no se pueden devolver 204, 400, 401 ni 404.
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


@pytest.mark.parametrize("nodo, validador", [
    ("Listar alertas pendientes", "Validar token (alertas)"),
    ("Descartar alerta", "Validar token (descartar)"),
    ("Guardar ubicacion", "Validar token (ubicacion)"),
])
def test_el_usuario_sale_siempre_del_token(nodo, validador):
    """Contrato C1: el usuario_id nunca sale del cuerpo ni de la URL."""
    reemplazo = NODOS[nodo]["parameters"]["options"]["queryReplacement"]
    assert f"$('{validador}').first().json.usuario_id" in reemplazo
    assert "body.usuario" not in reemplazo and "query.usuario" not in reemplazo


def test_un_token_invalido_corta_antes_de_tocar_la_base():
    """La rama falsa de cada IF de token va directo a un nodo de respuesta."""
    for ifs, respuesta in [
        ("Token valido? (alertas)", "Responder error (alertas)"),
        ("Token valido? (descartar)", "Responder error (descartar)"),
        ("Token valido? (ubicacion)", "Responder error (ubicacion)"),
    ]:
        rama_falsa = WF["connections"][ifs]["main"][1]
        assert [d["node"] for d in rama_falsa] == [respuesta]
        assert NODOS[respuesta]["parameters"]["options"]["responseCode"] == "={{ $json.http_code }}"


def test_la_consulta_de_alertas_respeta_el_contrato():
    sql = consulta("Listar alertas pendientes")
    assert "a.descartada_en IS NULL" in sql            # solo pendientes
    assert "INTERVAL '7 days'" in sql                   # ultimos 7 dias
    assert "ORDER BY a.creada_en DESC" in sql           # mas recientes primero
    assert "a.usuario_id = $1::UUID" in sql             # solo las suyas


def test_la_consulta_de_descarte_filtra_por_id_y_por_usuario():
    sql = consulta("Descartar alerta")
    assert "WHERE id = $1::UUID" in sql
    assert "AND usuario_id = $2::UUID" in sql
    # Descartar dos veces responde 200 y conserva la primera fecha.
    assert "COALESCE(descartada_en, now())" in sql
    assert "RETURNING id" in sql


def test_la_ubicacion_se_sobrescribe_y_no_guarda_historial():
    sql = consulta("Guardar ubicacion")
    assert sql.lstrip().startswith("--")
    assert "UPDATE usuarios" in sql
    assert "ubicacion_actualizada_en = now()" in sql
    assert "INSERT" not in sql.upper().split("--")[-1]


def test_la_ubicacion_responde_204_sin_cuerpo():
    respuesta = NODOS["Responder: ubicacion guardada"]["parameters"]
    assert respuesta["respondWith"] == "noData"
    assert respuesta["options"]["responseCode"] == 204


# ---------------------------------------------------------------------------
# Nodos Code
# ---------------------------------------------------------------------------

def descartar(cuerpo):
    return ejecutar("Validar id de la alerta", [{}],
                    nodos={"Webhook Descartar Alerta": [{"body": cuerpo}]})[0]


def test_el_id_de_la_alerta_se_acepta_cuando_es_uuid():
    assert descartar({"id": ALERTA_RECIENTE}) == {"valido": True, "alerta_id": ALERTA_RECIENTE}


@pytest.mark.parametrize("cuerpo", [{}, {"id": None}, {"id": ""}, {"id": 42}, {"id": "no-uuid"}])
def test_un_id_que_no_es_uuid_recibe_el_mismo_404_que_una_alerta_ajena(cuerpo):
    salida = descartar(cuerpo)
    assert salida["valido"] is False
    assert salida["http_code"] == 404
    assert salida["cuerpo"] == {"error": "alerta_no_encontrada"}


def coordenadas(cuerpo):
    return ejecutar("Validar coordenadas", [{}],
                    nodos={"Webhook Guardar Ubicacion": [{"body": cuerpo}]})[0]


def test_las_coordenadas_validas_pasan():
    assert coordenadas({"lat": LAT, "lng": LON}) == {"valido": True, "lat": LAT, "lng": LON}


@pytest.mark.parametrize("cuerpo", [
    {},                                  # sin cuerpo
    {"lat": LAT},                        # falta lng
    {"lng": LON},                        # falta lat
    {"lat": None, "lng": LON},
    {"lat": "", "lng": LON},
    {"lat": "arriba", "lng": LON},       # no numerico
    {"lat": -91, "lng": LON},            # fuera de rango
    {"lat": 91, "lng": LON},
    {"lat": LAT, "lng": -181},
    {"lat": LAT, "lng": 181},
])
def test_las_coordenadas_invalidas_dan_400(cuerpo):
    salida = coordenadas(cuerpo)
    assert salida["valido"] is False
    assert salida["http_code"] == 400
    assert salida["cuerpo"] == {"error": "datos_invalidos"}


def test_la_lista_de_alertas_usa_el_formato_del_contrato():
    salida = ejecutar("Armar lista de alertas", [{
        "id": ALERTA_RECIENTE, "reporte_id": REPORTE, "tipo": "infraestructura_vial",
        "severidad": "alta", "distancia_m": 320, "lat": LAT, "lng": LON,
        "creada_en": "2026-10-24T15:02:11Z",
    }])[0]
    assert salida["http_code"] == 200
    assert salida["cuerpo"] == [{
        "id": ALERTA_RECIENTE, "reporte_id": REPORTE, "tipo": "infraestructura_vial",
        "severidad": "alta", "distancia_m": 320, "lat": LAT, "lng": LON,
        "creada_en": "2026-10-24T15:02:11Z",
    }]


def test_sin_alertas_la_lista_es_un_arreglo_vacio():
    # Lo que entrega el nodo Postgres con alwaysOutputData y cero filas.
    salida = ejecutar("Armar lista de alertas", [{}])[0]
    assert salida == {"http_code": 200, "cuerpo": []}


def test_el_descarte_responde_ok_cuando_actualizo_una_fila():
    salida = ejecutar("Armar respuesta (descartar)", [{"id": ALERTA_RECIENTE}])[0]
    assert salida == {"http_code": 200, "cuerpo": {"ok": True}}


def test_el_descarte_responde_404_cuando_no_actualizo_nada():
    salida = ejecutar("Armar respuesta (descartar)", [{}])[0]
    assert salida == {"http_code": 404, "cuerpo": {"error": "alerta_no_encontrada"}}


# ---------------------------------------------------------------------------
# Las consultas del workflow contra Postgres (PostGIS)
# ---------------------------------------------------------------------------

try:
    import psycopg
except ModuleNotFoundError:  # pragma: no cover
    psycopg = None

requiere_bd = pytest.mark.skipif(
    psycopg is None, reason="falta psycopg (pip install 'psycopg[binary]')"
)

LISTAR = consulta("Listar alertas pendientes")
DESCARTAR = consulta("Descartar alerta")
GUARDAR = consulta("Guardar ubicacion")


@pytest.fixture
def conn(dsn):
    with psycopg.connect(dsn) as c:
        yield c
        c.rollback()


@pytest.fixture
def base(conn):
    """Dos ciudadanos, un reporte critico y tres alertas; se revierte al final."""
    with psycopg.RawCursor(conn) as cur:
        for uid in (CIUDADANO, OTRO_CIUDADANO):
            cur.execute(
                "INSERT INTO usuarios (id, username, email, password_hash,"
                " password_salt, role) VALUES ($1, $2, $3, 'x', 'x', 'ciudadano')",
                (uid, "u" + uid[:8], uid[:8] + "@urbanpulse.pe"),
            )
        for rid in (REPORTE, REPORTE_ANTERIOR):
            cur.execute(
                "INSERT INTO reports (id, description, incident_type, severity,"
                " latitude, longitude, status, usuario_id)"
                " VALUES ($1, 'Reporte de prueba HU-10 T03', 'infraestructura_vial',"
                " 'alta', $2, $3, 'pending', $4)",
                (rid, LAT, LON, OTRO_CIUDADANO),
            )
        # UNIQUE (reporte_id, usuario_id): la alerta vieja va de otro reporte.
        alertas = [
            # id, usuario, reporte, distancia, dias de antiguedad
            (ALERTA_RECIENTE, CIUDADANO, REPORTE, 320, 0),
            (ALERTA_VIEJA, CIUDADANO, REPORTE_ANTERIOR, 150, 8),
            (ALERTA_AJENA, OTRO_CIUDADANO, REPORTE, 410, 0),
        ]
        for aid, uid, rid, distancia, dias in alertas:
            cur.execute(
                "INSERT INTO alertas_ciudadano (id, reporte_id, usuario_id,"
                " distancia_m, creada_en) VALUES ($1, $2, $3, $4,"
                " now() - make_interval(days => $5::int))",
                (aid, rid, uid, distancia, dias),
            )
    return conn


def listar(conn, usuario_id):
    with psycopg.RawCursor(conn) as cur:
        cur.execute(LISTAR, (usuario_id,))
        columnas = [d.name for d in cur.description]
        return [dict(zip(columnas, fila)) for fila in cur.fetchall()]


def descartar_alerta(conn, alerta_id, usuario_id):
    with psycopg.RawCursor(conn) as cur:
        cur.execute(DESCARTAR, (alerta_id, usuario_id))
        return cur.fetchall()


@requiere_bd
def test_solo_devuelve_las_alertas_pendientes_del_ciudadano(base):
    filas = listar(base, CIUDADANO)

    assert len(filas) == 1, filas
    alerta = filas[0]
    assert str(alerta["id"]) == ALERTA_RECIENTE          # la de hace 8 dias no entra
    assert str(alerta["reporte_id"]) == REPORTE
    assert alerta["tipo"] == "infraestructura_vial"
    assert alerta["severidad"] == "alta"
    assert alerta["distancia_m"] == 320
    assert (alerta["lat"], alerta["lng"]) == (LAT, LON)
    assert alerta["creada_en"].endswith("Z")             # formato del contrato


@requiere_bd
def test_un_ciudadano_no_ve_las_alertas_de_otro(base):
    ajenas = {str(f["id"]) for f in listar(base, CIUDADANO)}
    assert ALERTA_AJENA not in ajenas
    assert {str(f["id"]) for f in listar(base, OTRO_CIUDADANO)} == {ALERTA_AJENA}


@requiere_bd
def test_una_alerta_descartada_no_vuelve_a_aparecer(base):
    """HU-10 T03, «Hecha cuando»: primera mitad."""
    assert descartar_alerta(base, ALERTA_RECIENTE, CIUDADANO) == [(uuid.UUID(ALERTA_RECIENTE),)]
    assert listar(base, CIUDADANO) == []

    with psycopg.RawCursor(base) as cur:
        cur.execute("SELECT descartada_en FROM alertas_ciudadano WHERE id = $1::uuid",
                    (ALERTA_RECIENTE,))
        assert cur.fetchone()[0] is not None


@requiere_bd
def test_otro_ciudadano_no_puede_descartar_alertas_ajenas(base):
    """HU-10 T03, «Hecha cuando»: segunda mitad. Sin filas, el flujo responde 404."""
    assert descartar_alerta(base, ALERTA_AJENA, CIUDADANO) == []

    with psycopg.RawCursor(base) as cur:
        cur.execute("SELECT descartada_en FROM alertas_ciudadano WHERE id = $1::uuid",
                    (ALERTA_AJENA,))
        assert cur.fetchone()[0] is None       # la alerta del otro sigue pendiente


@requiere_bd
def test_descartar_dos_veces_responde_igual_y_conserva_la_fecha(base):
    primera = descartar_alerta(base, ALERTA_RECIENTE, CIUDADANO)
    with psycopg.RawCursor(base) as cur:
        cur.execute("SELECT descartada_en FROM alertas_ciudadano WHERE id = $1::uuid",
                    (ALERTA_RECIENTE,))
        fecha = cur.fetchone()[0]

    segunda = descartar_alerta(base, ALERTA_RECIENTE, CIUDADANO)

    assert primera == segunda                   # las dos veces: 200 { ok: true }
    with psycopg.RawCursor(base) as cur:
        cur.execute("SELECT descartada_en FROM alertas_ciudadano WHERE id = $1::uuid",
                    (ALERTA_RECIENTE,))
        assert cur.fetchone()[0] == fecha       # COALESCE deja la primera fecha


@requiere_bd
def test_guardar_la_ubicacion_la_sobrescribe_con_su_fecha(base):
    with psycopg.RawCursor(base) as cur:
        cur.execute(GUARDAR, (CIUDADANO, LON, LAT))
        cur.execute(
            "SELECT ST_Y(ultima_ubicacion::geometry), ST_X(ultima_ubicacion::geometry),"
            " now() - ubicacion_actualizada_en < interval '1 minute'"
            " FROM usuarios WHERE id = $1::uuid", (CIUDADANO,))
        lat, lng, reciente = cur.fetchone()
        assert round(lat, 6) == LAT and round(lng, 6) == LON
        assert reciente is True

        # Una segunda ubicacion reemplaza a la anterior: no hay historial.
        cur.execute(GUARDAR, (CIUDADANO, LON + 0.01, LAT + 0.01))
        cur.execute(
            "SELECT ST_Y(ultima_ubicacion::geometry), count(*) OVER ()"
            " FROM usuarios WHERE id = $1::uuid", (CIUDADANO,))
        nueva_lat, filas = cur.fetchone()
        assert round(nueva_lat, 6) == round(LAT + 0.01, 6)
        assert filas == 1


@requiere_bd
def test_la_ubicacion_guardada_queda_lista_para_las_alertas_de_t02(base):
    """La fecha que guarda este webhook es la que mira la ventana de 24 h."""
    with psycopg.RawCursor(base) as cur:
        cur.execute(GUARDAR, (CIUDADANO, LON, LAT))
        cur.execute(
            "SELECT ST_DWithin(u.ultima_ubicacion,"
            "   ST_SetSRID(ST_MakePoint(r.longitude, r.latitude), 4326)::geography, 500)"
            " AND u.ubicacion_actualizada_en > now() - interval '24 hours'"
            " FROM usuarios AS u, reports AS r"
            " WHERE u.id = $1::uuid AND r.id = $2::uuid", (CIUDADANO, REPORTE))
        assert cur.fetchone()[0] is True
