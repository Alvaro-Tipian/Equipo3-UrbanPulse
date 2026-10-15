"""Pruebas del workflow que registra despliegues en el Service Desk (HT-41 T03).

Ejecuta en Node.js los nodos Code reales, igual que n8n. Lo que se comprueba es
el contrato con los workflows de despliegue: qué avisos se aceptan, a qué tipo
de solicitud del portal va cada uno y qué se responde cuando algo falla.
"""

import json
import subprocess
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[3]
WORKFLOW = RAIZ / "ia-ops" / "workflows" / "n8n_registrar_despliegue.json"
HARNESS = Path(__file__).with_name("ejecutar_nodo.mjs")

VALIDAR = "Validar aviso de despliegue"
RESOLVER = "Resolver portal del proyecto"
RESPUESTA = "Armar respuesta"


def ejecutar(nodo, entrada, nodos=None):
    proc = subprocess.run(
        ["node", str(HARNESS), str(WORKFLOW), nodo],
        input=json.dumps({"entrada": entrada, "nodos": nodos or {}}),
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
    return json.loads(proc.stdout)[0]


def aviso(**cambios):
    base = {
        "eventType": "deployment_success",
        "projectKey": "UPTI",
        "commitSha": "9f3c1d2a9f3c1d2a9f3c1d2a9f3c1d2a9f3c1d2a",
        "repository": "SergioAscurraPerez/Equipo3-UrbanPulse",
        "runId": "38460872588",
        "message": "Despliegue automático de n8n en AWS Lightsail exitoso.",
    }
    base.update(cambios)
    return [{"body": base}]


# --- Validación y mapeo de tipos ------------------------------------------

def test_un_despliegue_correcto_abre_una_solicitud_de_cambio():
    s = ejecutar(VALIDAR, aviso())
    assert s["es_valido"] is True
    assert s["requestTypeId"] == "19"
    assert s["etiqueta"] == "Solicitud de cambio"


def test_la_deriva_del_modelo_abre_un_fallo_de_plataforma_con_el_modelo():
    # Es el aviso que manda ml-monitoring.yml (HT-49 T03). Antes el webhook lo
    # rechazaba con 400 y el ticket de deriva nunca se creaba.
    s = ejecutar(VALIDAR, aviso(eventType="model_drift", modelName="riesgo_vial",
                                modelVersion="4", psi=0.31,
                                message="Deriva detectada."))
    assert s["es_valido"] is True
    assert s["requestTypeId"] == "16"
    assert s["resumen"] == "[Deriva del modelo] riesgo_vial v4 (run 38460872588)"
    assert "PSI maximo: 0.31" in s["descripcion"]
    assert "Version: 4" in s["descripcion"]


def test_la_deriva_sin_version_no_rompe_el_resumen():
    s = ejecutar(VALIDAR, aviso(eventType="model_drift", modelName="riesgo_vial",
                                modelVersion=None, psi=None))
    assert s["resumen"] == "[Deriva del modelo] riesgo_vial v? (run 38460872588)"
    assert "PSI maximo: no disponible" in s["descripcion"]


def test_un_despliegue_fallido_abre_un_fallo_de_plataforma():
    s = ejecutar(VALIDAR, aviso(eventType="deployment_failure"))
    assert s["requestTypeId"] == "16"
    assert s["etiqueta"] == "Fallo de la plataforma"


@pytest.mark.parametrize("campo", ["projectKey", "commitSha", "repository", "runId"])
def test_sin_un_campo_obligatorio_responde_400(campo):
    s = ejecutar(VALIDAR, aviso(**{campo: ""}))
    assert s["es_valido"] is False
    assert s["http_code"] == 400
    assert campo in s["response_body"]["error"]


def test_un_tipo_de_evento_desconocido_responde_400():
    s = ejecutar(VALIDAR, aviso(eventType="deployment_lo_que_sea"))
    assert s["http_code"] == 400
    assert "eventType" in s["response_body"]["error"]


def test_el_resumen_lleva_el_commit_corto_y_el_run_para_reconocer_repetidos():
    s = ejecutar(VALIDAR, aviso())
    assert "9f3c1d2" in s["resumen"]
    assert "38460872588" in s["resumen"]
    assert s["descripcion"].endswith(
        "Ejecucion: https://github.com/SergioAscurraPerez/Equipo3-UrbanPulse/actions/runs/38460872588"
    )


def test_sin_mensaje_no_se_manda_una_descripcion_vacia():
    s = ejecutar(VALIDAR, aviso(message=""))
    assert s["descripcion"].startswith("Sin mensaje.")


# --- Resolución del portal -------------------------------------------------

PORTALES = [{"id": 1, "projectKey": "OTRO"}, {"id": 7, "projectKey": "UPTI"}]


def test_se_resuelve_el_portal_por_la_clave_del_proyecto():
    s = ejecutar(RESOLVER, [{"values": PORTALES}],
                 nodos={VALIDAR: [{"projectKey": "UPTI"}]})
    assert s["serviceDeskId"] == "7"


def test_si_el_proyecto_no_tiene_portal_se_dice_cual_hay():
    s = ejecutar(RESOLVER, [{"values": PORTALES}],
                 nodos={VALIDAR: [{"projectKey": "NOEXISTE"}]})
    assert s["http_code"] == 502
    assert "OTRO" in s["response_body"]["error"]


# --- Respuesta final -------------------------------------------------------

def test_cuando_jira_crea_la_solicitud_se_devuelve_su_clave():
    creado = {"issueKey": "UPTI-42", "_links": {"web": "https://x/UPTI-42"}}
    s = ejecutar(RESPUESTA, [creado], nodos={VALIDAR: [{"etiqueta": "Solicitud de cambio"}]})
    assert s["http_code"] == 201
    assert s["response_body"]["ticket"] == "UPTI-42"


def test_si_jira_rechaza_se_devuelve_su_error_y_no_un_exito_falso():
    s = ejecutar(RESPUESTA, [{"errorMessage": "requestTypeId invalido"}],
                 nodos={VALIDAR: [{"etiqueta": "Solicitud de cambio"}]})
    assert s["http_code"] == 502
    assert "requestTypeId" in str(s["response_body"]["detalle"])
