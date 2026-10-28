"""verificar_rotacion.py (HT-36 T06): sin red, con http() simulado."""
import json
import os
import shutil
import subprocess

import pytest

import verificar_rotacion as vr

RAIZ = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
HARNESS = os.path.join(RAIZ, "ia-ops", "workflows", "tests", "ejecutar_nodo.mjs")
VALIDADOR = os.path.join(RAIZ, "ia-ops", "workflows", "n8n_validar_token.json")


@pytest.fixture
def respuestas(monkeypatch):
    """Simula http(): devuelve el codigo configurado y guarda cada llamada."""
    estado = {"codigo": 401, "llamadas": []}

    def falso(metodo, url, cabeceras=None, cuerpo=None):
        estado["llamadas"].append({"metodo": metodo, "url": url, "cabeceras": cabeceras or {}, "cuerpo": cuerpo})
        return estado["codigo"]

    monkeypatch.setattr(vr, "http", falso)
    return estado


def validar(token, secreto):
    proc = subprocess.run(
        ["node", HARNESS, VALIDADOR, "Validar token"],
        input=json.dumps({
            "entrada": [{"rol_minimo": "operador", "authorization": f"Bearer {token}"}],
            "env": {"N8N_AUTH_SECRET": secreto},
        }),
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)[0]


@pytest.mark.skipif(not shutil.which("node"), reason="requiere Node.js")
def test_el_token_de_prueba_lo_acepta_el_validador_real_con_su_secreto():
    assert validar(vr.token_firmado("secreto-a"), "secreto-a")["valido"] is True


@pytest.mark.skipif(not shutil.which("node"), reason="requiere Node.js")
def test_el_token_de_prueba_lo_rechaza_el_validador_real_con_otro_secreto():
    resultado = validar(vr.token_firmado("secreto-anterior"), "secreto-nuevo")
    assert resultado["valido"] is False and resultado["http_code"] == 401


@pytest.mark.parametrize("prueba, rechazo", [
    (vr.token_n8n, 401),
    (vr.webhook_despliegue, 403),
    (vr.funcion_vercel, 401),
    (vr.gemini, 400),
    (vr.groq, 401),
])
def test_un_rechazo_cuenta_como_rechazada(respuestas, prueba, rechazo):
    respuestas["codigo"] = rechazo
    assert prueba("clave-anterior")[0] == vr.RECHAZADA


@pytest.mark.parametrize("prueba, codigo", [
    (vr.token_n8n, 200),            # el secreto anterior sigue firmando tokens validos
    (vr.webhook_despliegue, 400),   # paso la autenticacion y fallo por el cuerpo vacio
    (vr.funcion_vercel, 400),
    (vr.gemini, 200),
    (vr.groq, 200),
])
def test_si_la_clave_anterior_entra_lo_marca(respuestas, prueba, codigo):
    respuestas["codigo"] = codigo
    assert prueba("clave-anterior")[0] == vr.ACEPTADA


def test_los_webhooks_reciben_un_cuerpo_vacio_para_no_crear_tickets(respuestas):
    vr.webhook_despliegue("x")
    vr.funcion_vercel("x")
    assert [l["cuerpo"] for l in respuestas["llamadas"]] == ["{}", "{}"]


def test_la_firma_de_la_funcion_es_hmac_del_cuerpo(respuestas):
    import hashlib
    import hmac
    vr.funcion_vercel("secreto")
    firma = respuestas["llamadas"][0]["cabeceras"]["X-UrbanPulse-Signature"]
    assert firma == hmac.new(b"secreto", b"{}", hashlib.sha256).hexdigest()


def test_jira_sin_email_se_omite(respuestas, monkeypatch):
    monkeypatch.delenv("JIRA_EMAIL", raising=False)
    assert vr.jira("token")[0] == vr.OMITIDA
    assert respuestas["llamadas"] == []


def test_main_omite_lo_que_no_tiene_variable_y_no_imprime_claves(respuestas, monkeypatch, capsys):
    for _, variable, _ in vr.PRUEBAS:
        monkeypatch.delenv(variable, raising=False)
    monkeypatch.setenv("GROQ_API_KEY_ANTERIOR", "gsk_clave_que_no_debe_salir")
    respuestas["codigo"] = 401
    assert vr.main() == 0
    salida = capsys.readouterr().out
    assert "gsk_clave_que_no_debe_salir" not in salida
    assert salida.count(vr.OMITIDA) == len(vr.PRUEBAS) - 1


def test_main_sin_ninguna_variable_no_da_por_buena_la_rotacion(respuestas, monkeypatch):
    for _, variable, _ in vr.PRUEBAS:
        monkeypatch.delenv(variable, raising=False)
    assert vr.main() == 1
    assert respuestas["llamadas"] == []


def test_main_falla_si_una_clave_anterior_sigue_entrando(respuestas, monkeypatch):
    for _, variable, _ in vr.PRUEBAS:
        monkeypatch.delenv(variable, raising=False)
    monkeypatch.setenv("GEMINI_API_KEY_ANTERIOR", "x")
    respuestas["codigo"] = 200
    assert vr.main() == 1


def test_un_error_de_red_no_cuenta_como_rechazo(monkeypatch):
    for _, variable, _ in vr.PRUEBAS:
        monkeypatch.delenv(variable, raising=False)
    monkeypatch.setenv("GROQ_API_KEY_ANTERIOR", "x")

    def caida(*a, **k):
        raise OSError("sin red")

    monkeypatch.setattr(vr, "http", caida)
    assert vr.main() == 1
