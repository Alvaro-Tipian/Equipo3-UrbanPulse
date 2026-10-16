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
ARMAR = "Armar solicitud"
CREAR = "Crear solicitud en el portal"
RESPUESTA = "Armar respuesta"
PRODUCCION = RAIZ / "src" / "n8n-workflows" / "production" / "urbanpulse-registrar-despliegue.json"


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


# --- Campos del formulario ------------------------------------------------
# El formulario de "Solicitud de cambio" del portal UPTI no tiene el campo
# Descripcion, y Jira rechazaba la solicitud entera con 400 ("El campo
# 'description' no es valido para este tipo de solicitud"): el despliegue
# recibia 502 y no se creaba ningun ticket.

DETALLE = {"requestTypeId": "19", "resumen": "[Solicitud de cambio] repo @ 9f3c1d2 (run 1)",
           "descripcion": "Despliegue ok.\n\nCommit: 9f3c1d2"}


def armar(campos):
    return ejecutar(ARMAR, [campos], nodos={VALIDAR: [DETALLE], RESOLVER: [{"serviceDeskId": "2"}]})


def test_si_el_formulario_no_tiene_descripcion_va_como_comentario():
    s = armar({"requestTypeFields": [{"fieldId": "summary"}]})
    assert s["cuerpo"] == {"serviceDeskId": "2", "requestTypeId": "19",
                           "requestFieldValues": {"summary": DETALLE["resumen"]}}
    assert s["comentario"] == DETALLE["descripcion"]


def test_si_el_formulario_tiene_descripcion_va_en_la_solicitud():
    s = armar({"requestTypeFields": [{"fieldId": "summary"}, {"fieldId": "description"}]})
    assert s["cuerpo"]["requestFieldValues"]["description"] == DETALLE["descripcion"]
    assert s["comentario"] == ""


def test_si_no_se_pudieron_leer_los_campos_no_se_arriesga_la_descripcion():
    s = armar({"error": {"message": "403"}})
    assert "description" not in s["cuerpo"]["requestFieldValues"]
    assert s["comentario"] == DETALLE["descripcion"]


def flujo(ruta=WORKFLOW):
    return json.loads(ruta.read_text(encoding="utf-8"))


def destinos(origen, salida=0):
    return [c["node"] for c in flujo()["connections"][origen]["main"][salida]]


def test_orden_del_flujo_con_campos_y_comentario():
    assert destinos(RESOLVER) == ["Campos del tipo de solicitud"]
    assert destinos("Campos del tipo de solicitud") == [ARMAR]
    assert destinos(ARMAR) == [CREAR]
    assert destinos(CREAR) == ["Falta el detalle?"]
    assert destinos("Falta el detalle?", 0) == ["Agregar detalle como comentario"]
    assert destinos("Falta el detalle?", 1) == [RESPUESTA]
    assert destinos("Agregar detalle como comentario") == [RESPUESTA]
    nodos = {n["name"]: n for n in flujo()["nodes"]}
    assert nodos[CREAR]["parameters"]["jsonBody"] == "={{ $json.cuerpo }}"
    comentario = nodos["Agregar detalle como comentario"]
    assert "public: false" in comentario["parameters"]["jsonBody"]
    # Un comentario que falla no debe tapar el ticket ya creado.
    assert comentario.get("onError") == "continueRegularOutput"
    assert nodos["Campos del tipo de solicitud"].get("onError") == "continueRegularOutput"


def test_la_copia_de_produccion_es_identica():
    assert flujo(PRODUCCION) == flujo()


# --- Respuesta final -------------------------------------------------------

def test_cuando_jira_crea_la_solicitud_se_devuelve_su_clave():
    creado = {"issueKey": "UPTI-42", "_links": {"web": "https://x/UPTI-42"}}
    s = ejecutar(RESPUESTA, [{"id": "comentario-1"}],
                 nodos={VALIDAR: [{"etiqueta": "Solicitud de cambio"}], CREAR: [creado]})
    assert s["http_code"] == 201
    assert s["response_body"]["ticket"] == "UPTI-42"


def test_si_jira_rechaza_se_devuelve_su_error_y_no_un_exito_falso():
    s = ejecutar(RESPUESTA, [{"errorMessage": "requestTypeId invalido"}],
                 nodos={VALIDAR: [{"etiqueta": "Solicitud de cambio"}],
                        CREAR: [{"errorMessage": "requestTypeId invalido"}]})
    assert s["http_code"] == 502
    assert "requestTypeId" in str(s["response_body"]["detalle"])
