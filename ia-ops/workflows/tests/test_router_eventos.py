"""Pruebas del validador del enrutador de eventos (HT-51 T02).

Corre el jsCode real del nodo "Validar Esquema del Sobre de Eventos" en
Node.js, igual que lo ejecuta n8n. Lo que se comprueba es el contrato que
documenta docs/EVENT_ROUTER_CONTRACT.md: que sobre entra con 202 y cual
se rechaza con 400 y por que.
"""

import json
import subprocess
import uuid
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parents[3]
WORKFLOW = RAIZ / "ia-ops" / "workflows" / "n8n_event_router.json"
HARNESS = Path(__file__).with_name("ejecutar_nodo.mjs")
NODO = "Validar Esquema del Sobre de Eventos"


def validar(sobre):
    proc = subprocess.run(
        ["node", str(HARNESS), str(WORKFLOW), NODO],
        input=json.dumps({"entrada": [{"body": sobre}], "nodos": {}}),
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    return json.loads(proc.stdout)[0]


def sobre(tipo, **datos):
    return {
        "id": str(uuid.uuid4()),
        "tipo": tipo,
        "fecha": "2026-10-13T20:12:20Z",
        "origen": "pytest",
        "datos": datos,
    }


DATOS_MODELO = {
    "modelo": "riesgo_vial", "version": "7", "psi_max": 0.08,
    "f1_real": 0.91, "reporte_url": "https://github.com/x/y/actions/runs/1",
}

ACEPTADOS = [
    sobre("reporte.creado", reporte_id=str(uuid.uuid4()), distrito="MIRAFLORES",
          franja="manana", tipo_incidente="choque"),
    sobre("reporte.estado_cambiado", reporte_id=str(uuid.uuid4()),
          estado_anterior="pending", estado_nuevo="en_proceso"),
    sobre("n8n.flujo_fallido", workflow_id="w1", workflow_nombre="Central",
          ejecucion_id="42", mensaje_error="timeout"),
    sobre("modelo.deriva_detectada", **DATOS_MODELO),
    sobre("modelo.monitoreado", **DATOS_MODELO),
    sobre("operativo.creado", operativo_id=str(uuid.uuid4()), zona_id="MIRAFLORES",
          reportes=5),
    sobre("operativo.cerrado", operativo_id=str(uuid.uuid4()), zona_id="MIRAFLORES",
          cuadrilla_id=1, reportes=5, horas_atencion=26.5),
]


@pytest.mark.parametrize("entrada", ACEPTADOS, ids=[s["tipo"] for s in ACEPTADOS])
def test_los_tipos_del_contrato_se_aceptan(entrada):
    assert validar(entrada)["http_code"] == 202


def test_un_cierre_inmediato_con_cero_horas_se_acepta(entrada=None):
    # horas_atencion = 0 es un numero valido: si el validador lo midiera por
    # truthy, un operativo cerrado el mismo minuto se iria con un 400.
    r = validar(sobre("operativo.cerrado", operativo_id=str(uuid.uuid4()),
                      zona_id="SIN_DISTRITO", cuadrilla_id=4, reportes=1,
                      horas_atencion=0))
    assert r["es_valido"] is True and r["http_code"] == 202


@pytest.mark.parametrize("falta", ["operativo_id", "zona_id", "reportes"])
def test_operativo_creado_exige_sus_campos(falta):
    datos = {"operativo_id": str(uuid.uuid4()), "zona_id": "MIRAFLORES", "reportes": 5}
    del datos[falta]
    salida = validar(sobre("operativo.creado", **datos))
    assert salida["http_code"] == 400
    assert falta in salida["response_body"]["detalle"]


@pytest.mark.parametrize("falta", ["operativo_id", "zona_id", "cuadrilla_id",
                                   "reportes", "horas_atencion"])
def test_operativo_cerrado_exige_sus_campos(falta):
    # Sin horas_atencion ni cuadrilla_id, HU-11 no tendria que medir.
    datos = {"operativo_id": str(uuid.uuid4()), "zona_id": "MIRAFLORES",
             "cuadrilla_id": 1, "reportes": 5, "horas_atencion": 26.5}
    del datos[falta]
    salida = validar(sobre("operativo.cerrado", **datos))
    assert salida["http_code"] == 400
    assert falta in salida["response_body"]["detalle"]


@pytest.mark.parametrize("campo", ["cuadrilla_id", "reportes", "horas_atencion"])
def test_un_numero_en_null_no_pasa_por_cero(campo):
    datos = {"operativo_id": str(uuid.uuid4()), "zona_id": "MIRAFLORES",
             "cuadrilla_id": 1, "reportes": 5, "horas_atencion": 26.5}
    datos[campo] = None
    assert validar(sobre("operativo.cerrado", **datos))["http_code"] == 400


def test_el_monitoreo_diario_exige_los_mismos_campos_que_la_deriva():
    # Si el monitoreo publicara sin f1_real, HU-13 T01 no tendria que leer.
    incompleto = sobre("modelo.monitoreado", modelo="riesgo_vial", version="7")
    salida = validar(incompleto)
    assert salida["http_code"] == 400
    assert "f1_real" in salida["response_body"]["detalle"]


def test_los_estados_son_los_de_la_base_no_los_capitalizados():
    # reports_status_check solo admite pending | en_proceso | resuelto.
    malo = sobre("reporte.estado_cambiado", reporte_id=str(uuid.uuid4()),
                 estado_anterior="Pendiente", estado_nuevo="En Proceso")
    assert validar(malo)["http_code"] == 400


def test_un_tipo_inventado_se_rechaza():
    salida = validar(sobre("modelo.lo_que_sea", **DATOS_MODELO))
    assert salida["http_code"] == 400
    assert "tipo" in salida["response_body"]["detalle"]


def test_el_id_tiene_que_ser_uuid_v4():
    malo = sobre("modelo.monitoreado", **DATOS_MODELO)
    malo["id"] = "12345"
    assert validar(malo)["http_code"] == 400


def test_la_franja_con_enie_se_rechaza():
    # El catalogo real es el de la base: manana | tarde | noche, sin enie.
    # Un evento con "mañana" pasaria el validador pero luego no casaria con
    # ninguna ficha de conocimiento_vial.
    malo = sobre("reporte.creado", reporte_id=str(uuid.uuid4()),
                 distrito="SURCO", franja="mañana", tipo_incidente="choque")
    assert validar(malo)["http_code"] == 400


def test_monitoreo_sin_predicciones_suficientes_se_acepta():
    # Lo que publica ml-monitoring.yml cuando monitor.py no tiene datos para
    # medir: sin F1 ni PSI, con el motivo. El validador lo tiene que aceptar,
    # o el estado de la plataforma nunca sabria que el monitoreo corrio.
    r = validar(sobre("modelo.monitoreado", modelo="riesgo_vial", version=None,
                      psi_max=None, f1_real=None,
                      reporte_url="https://github.com/x/y/actions/runs/2",
                      motivo="Sin predicciones suficientes para medir la deriva."))
    assert r["es_valido"] is True and r["http_code"] == 202

