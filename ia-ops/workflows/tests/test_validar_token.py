"""Subworkflow «Validar token» (HT-36 T01, contrato C1).

Ejecuta en Node.js el nodo Code real, igual que n8n. Los tokens se arman como
los arma el login de Central (nodo «Generar token1»): base64url del payload y
la firma HMAC-SHA256 en hexadecimal, con N8N_AUTH_SECRET.
"""

import base64
import hashlib
import hmac
import json
import subprocess
import time
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[3]
WORKFLOW = RAIZ / "ia-ops" / "workflows" / "n8n_validar_token.json"
PRODUCCION = RAIZ / "src" / "n8n-workflows" / "production" / "urbanpulse-validar-token.json"
CENTRAL = RAIZ / "src" / "n8n-workflows" / "production" / "UrbanPulse - Central.json"
HARNESS = Path(__file__).with_name("ejecutar_nodo.mjs")

VALIDAR = "Validar token"
SECRETO = "secreto-de-prueba"
USUARIO = "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b"


def ejecutar(nodo, entrada, nodos=None, env=None, workflow=WORKFLOW):
    proc = subprocess.run(
        ["node", str(HARNESS), str(workflow), nodo],
        input=json.dumps({"entrada": entrada, "nodos": nodos or {}, "env": env or {}}),
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
    return json.loads(proc.stdout)[0]


def token(rol="ciudadano", exp_ms=None, secreto=SECRETO, **cambios):
    ahora = int(time.time() * 1000)
    payload = {"sub": "ana@urbanpulse.pe", "id": USUARIO, "role": rol, "iat": ahora,
               "exp": ahora + 12 * 3600 * 1000 if exp_ms is None else exp_ms}
    payload.update(cambios)
    cuerpo = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    firma = hmac.new(secreto.encode(), cuerpo.encode(), hashlib.sha256).hexdigest()
    return f"{cuerpo}.{firma}"


def alterar_firma(t):
    return t[:-1] + ("1" if t[-1] == "0" else "0")


def validar(authorization, rol_minimo="ciudadano", env=None, permitir_sin_token=False):
    return ejecutar(VALIDAR, [{"rol_minimo": rol_minimo, "authorization": authorization,
                               "permitir_sin_token": permitir_sin_token}],
                    env={"N8N_AUTH_SECRET": SECRETO} if env is None else env)


# --- Token valido --------------------------------------------------------

def test_token_valido_devuelve_usuario_rol_y_exp_en_segundos():
    exp_ms = int(time.time() * 1000) + 3600 * 1000
    s = validar(f"Bearer {token(exp_ms=exp_ms)}")
    assert s == {"valido": True, "sin_token": False, "usuario_id": USUARIO,
                 "rol": "ciudadano", "exp": exp_ms // 1000}


def test_operador_puede_lo_que_pide_rol_ciudadano():
    s = validar(f"Bearer {token(rol='operador')}", rol_minimo="ciudadano")
    assert s["valido"] is True and s["rol"] == "operador"


def test_acepta_el_token_que_emite_el_login_de_central():
    emitido = ejecutar("Generar token1", [{}], workflow=CENTRAL, env={"N8N_AUTH_SECRET": SECRETO},
                       nodos={"Verificar credenciales1": [{"id": USUARIO, "email": "op@urbanpulse.pe",
                                                           "username": "op", "role": "operador"}]})
    s = validar(f"Bearer {emitido['token']}", rol_minimo="operador")
    assert s["valido"] is True and s["usuario_id"] == USUARIO and s["rol"] == "operador"


# --- 401 token_invalido ----------------------------------------------------

@pytest.mark.parametrize("cabecera", [
    "Bearer " + token(secreto="otro-secreto"),                     # firma de otro secreto
    "Bearer " + alterar_firma(token()),                             # firma alterada
    "Bearer " + token(exp_ms=int(time.time() * 1000) - 1000),       # expirado
    "Bearer " + token(rol="administrador"),                         # rol desconocido
    "Bearer " + token(id="no-es-uuid"),                             # usuario invalido
    "Bearer abc",                                                   # sin firma
    "Basic dXNlcjpwYXNz",                                           # otro esquema
    "Bearer " + base64.urlsafe_b64encode(b"no es json").decode().rstrip("=") + "." + "0" * 64,
])
def test_token_invalido_responde_401(cabecera):
    assert validar(cabecera) == {"valido": False, "http_code": 401, "error": "token_invalido"}


def test_payload_alterado_con_la_firma_original_responde_401():
    original = token(rol="ciudadano")
    cuerpo, firma = original.split(".")
    datos = json.loads(base64.urlsafe_b64decode(cuerpo + "=" * (-len(cuerpo) % 4)))
    datos["role"] = "operador"
    falso = base64.urlsafe_b64encode(json.dumps(datos).encode()).decode().rstrip("=")
    assert validar(f"Bearer {falso}.{firma}", rol_minimo="operador")["http_code"] == 401


# --- 403 rol_no_permitido --------------------------------------------------

def test_ciudadano_en_una_ruta_de_operador_responde_403():
    assert validar(f"Bearer {token()}", rol_minimo="operador") == {
        "valido": False, "http_code": 403, "error": "rol_no_permitido"}


def test_rol_minimo_desconocido_exige_operador():
    assert validar(f"Bearer {token()}", rol_minimo="")["http_code"] == 403


# --- Sin cabecera y configuracion -------------------------------------------

def test_sin_cabecera_responde_401():
    # Los webhooks nuevos (operativos, KPIs, alertas) exigen el token desde el
    # primer dia: no tienen clientes antiguos que lo omitan.
    assert validar("") == {"valido": False, "http_code": 401, "error": "token_invalido"}


def test_sin_cabecera_en_un_webhook_en_transicion_deja_pasar_sin_usuario():
    # reports-list, reports-history y report-resolve: mientras la app no envie
    # el token (HT-36 T03) una peticion sin cabecera sigue como antes.
    assert validar("", permitir_sin_token=True) == {
        "valido": True, "sin_token": True, "usuario_id": None, "rol": None, "exp": None}


def test_con_cabecera_se_valida_aunque_el_webhook_este_en_transicion():
    s = validar("Bearer " + alterar_firma(token()), permitir_sin_token=True)
    assert s == {"valido": False, "http_code": 401, "error": "token_invalido"}


def test_exigir_token_anula_la_transicion():
    codigo = json.loads(WORKFLOW.read_text(encoding="utf-8"))
    nodo = next(n for n in codigo["nodes"] if n["name"] == VALIDAR)
    nodo["parameters"]["jsCode"] = nodo["parameters"]["jsCode"].replace(
        "const EXIGIR_TOKEN = false;", "const EXIGIR_TOKEN = true;")
    obligatorio = WORKFLOW.with_name("tmp_validar_token_obligatorio.json")
    obligatorio.write_text(json.dumps(codigo), encoding="utf-8")
    try:
        s = ejecutar(VALIDAR, [{"rol_minimo": "ciudadano", "authorization": "", "permitir_sin_token": True}],
                     env={"N8N_AUTH_SECRET": SECRETO}, workflow=obligatorio)
    finally:
        obligatorio.unlink()
    assert s == {"valido": False, "http_code": 401, "error": "token_invalido"}


def test_sin_secreto_no_acepta_ningun_token():
    s = validar(f"Bearer {token()}", env={})
    assert s["valido"] is False and s["http_code"] == 500


# --- Estructura -----------------------------------------------------------

def test_entradas_del_subworkflow():
    nodos = {n["name"]: n for n in json.loads(WORKFLOW.read_text(encoding="utf-8"))["nodes"]}
    disparador = nodos["Desde otro workflow"]
    assert disparador["type"] == "n8n-nodes-base.executeWorkflowTrigger"
    nombres = [v["name"] for v in disparador["parameters"]["workflowInputs"]["values"]]
    assert nombres == ["rol_minimo", "authorization", "permitir_sin_token"]


def test_la_copia_de_produccion_es_identica():
    assert json.loads(PRODUCCION.read_text(encoding="utf-8")) == json.loads(WORKFLOW.read_text(encoding="utf-8"))


# --- Copias en linea ---------------------------------------------------------
# Llamar al subworkflow con Execute Workflow sumaba unos 5 s por peticion en la
# instancia de Lightsail, asi que los webhooks de Dashboard KPIs llevan el
# mismo codigo en un nodo Code. Solo puede cambiar de donde sale la entrada.

DASHBOARD = RAIZ / "src" / "n8n-workflows" / "production" / "UrbanPulse - Dashboard KPIs vr2.json"
OPERATIVOS = RAIZ / "ia-ops" / "workflows" / "n8n_operativos.json"
ALERTAS = RAIZ / "ia-ops" / "workflows" / "n8n_alertas.json"
ENTRADA = "const entrada = $input.first().json;"

# archivo, nodo, rol_minimo, en modo de transicion (permitir_sin_token)
COPIAS_EN_LINEA = [
    # reports-list sigue aceptando peticiones sin token: el mapa (/mapa) es
    # publico (opcion A, 30/10/2026). Con cabecera se valida igual.
    (DASHBOARD, "Validar token (lista)", "ciudadano", True),
    # HT-36 T03 activo en produccion (la app envia el token): exigen el token.
    (DASHBOARD, "Validar token (historial)", "ciudadano", False),
    (DASHBOARD, "Validar token (resolver)", "operador", False),
    # HU-09 T02: webhooks nuevos, sin clientes antiguos que omitan el token.
    (OPERATIVOS, "Validar token (zonas)", "operador", False),
    (OPERATIVOS, "Validar token (crear)", "operador", False),
    (OPERATIVOS, "Validar token (listar)", "operador", False),
    (OPERATIVOS, "Validar token (cuadrillas)", "operador", False),
    (OPERATIVOS, "Validar token (asignar)", "operador", False),
    # HU-10 T03: webhooks de alertas del ciudadano.
    (ALERTAS, "Validar token (alertas)", "ciudadano", False),
    (ALERTAS, "Validar token (descartar)", "ciudadano", False),
    (ALERTAS, "Validar token (ubicacion)", "ciudadano", False),
    # HU-11 T01: webhook nuevo de KPIs de operativos.
    (DASHBOARD, "Validar token (kpis operativos)", "operador", False),
]
NODOS_OPERATIVOS = [n for a, n, _, _ in COPIAS_EN_LINEA if a == OPERATIVOS]


def sin_cabecera_ni_entrada(codigo):
    import re
    codigo = codigo.split("// HT-36 T01 - Valida el token de sesion (contrato C1).", 1)[1]
    return re.sub(r"const entrada = \{.*?\n\};", ENTRADA, codigo, count=1, flags=re.S)


@pytest.mark.parametrize("archivo, nodo, rol, transicion", COPIAS_EN_LINEA,
                         ids=[f"{a.stem}:{n}" for a, n, _, _ in COPIAS_EN_LINEA])
def test_las_copias_en_linea_son_el_mismo_codigo(archivo, nodo, rol, transicion):
    base = next(n for n in json.loads(WORKFLOW.read_text(encoding="utf-8"))["nodes"] if n["name"] == VALIDAR)
    copia = next(n for n in json.loads(archivo.read_text(encoding="utf-8"))["nodes"] if n["name"] == nodo)
    original = base["parameters"]["jsCode"].split("// HT-36 T01 - Valida el token de sesion (contrato C1).", 1)[1]
    assert sin_cabecera_ni_entrada(copia["parameters"]["jsCode"]) == original
    assert f"rol_minimo: '{rol}'" in copia["parameters"]["jsCode"]
    # Solo reports-list sigue en modo de transicion.
    assert ("permitir_sin_token: true" in copia["parameters"]["jsCode"]) is transicion


@pytest.mark.parametrize("nodo", NODOS_OPERATIVOS)
def test_los_webhooks_de_operativos_exigen_token_de_operador(nodo):
    """HU-09 T02, «Hecha cuando»: un ciudadano recibe 403 en las cinco rutas."""
    def copia(authorization):
        return ejecutar(nodo, [{"headers": {"authorization": authorization}}],
                        env={"N8N_AUTH_SECRET": SECRETO}, workflow=OPERATIVOS)

    assert copia("") == {"valido": False, "http_code": 401, "error": "token_invalido"}
    assert copia(f"Bearer {token()}") == {
        "valido": False, "http_code": 403, "error": "rol_no_permitido"}
    operador = copia(f"Bearer {token(rol='operador')}")
    assert operador["valido"] is True and operador["sin_token"] is False
    assert operador["usuario_id"] == USUARIO and operador["rol"] == "operador"


def test_la_copia_en_linea_valida_igual_que_el_subworkflow():
    s = ejecutar("Validar token (resolver)", [{"headers": {"authorization": f"Bearer {token()}"}}],
                 env={"N8N_AUTH_SECRET": SECRETO}, workflow=DASHBOARD)
    assert s == {"valido": False, "http_code": 403, "error": "rol_no_permitido"}
    s = ejecutar("Validar token (lista)", [{"headers": {}}], env={"N8N_AUTH_SECRET": SECRETO}, workflow=DASHBOARD)
    assert s["valido"] is True and s["sin_token"] is True


@pytest.mark.parametrize("nodo, rol_que_pasa, rol_rechazado", [
    ("Validar token (historial)", "ciudadano", None),
    ("Validar token (resolver)", "operador", "ciudadano"),
])
def test_historial_y_resolver_exigen_el_token(nodo, rol_que_pasa, rol_rechazado):
    """DoD de HT-36 T01: sin token 401; un ciudadano en report-resolve, 403."""
    def copia(authorization):
        return ejecutar(nodo, [{"headers": {"authorization": authorization}}],
                        env={"N8N_AUTH_SECRET": SECRETO}, workflow=DASHBOARD)

    assert copia("") == {"valido": False, "http_code": 401, "error": "token_invalido"}
    assert copia("Bearer " + alterar_firma(token()))["http_code"] == 401
    ok = copia(f"Bearer {token(rol=rol_que_pasa)}")
    assert ok["valido"] is True and ok["usuario_id"] == USUARIO
    if rol_rechazado:
        assert copia(f"Bearer {token(rol=rol_rechazado)}")["http_code"] == 403


def test_reports_list_sigue_publica_para_el_mapa():
    s = ejecutar("Validar token (lista)", [{"headers": {}}],
                 env={"N8N_AUTH_SECRET": SECRETO}, workflow=DASHBOARD)
    assert s["valido"] is True and s["sin_token"] is True
