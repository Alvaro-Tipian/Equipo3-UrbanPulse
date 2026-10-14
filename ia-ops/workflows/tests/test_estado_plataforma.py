"""Pruebas del nodo que arma el estado de la plataforma (HU-13 T01).

Corre el jsCode real del nodo "Armar estado de la plataforma" en Node.js con
salidas simuladas de las sondas, de Neon y de Jira. Lo que se comprueba es el
contrato de docs/PLATFORM_HEALTH_WEBHOOK_CONTRACT.md: que cada servicio se
reporte por su propia medicion y que lo que no se pudo medir salga en null en
vez de inventado.
"""

import json
import subprocess
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
WORKFLOW = RAIZ / "ia-ops" / "workflows" / "n8n_estado_plataforma.json"
HARNESS = Path(__file__).with_name("ejecutar_nodo.mjs")
NODO = "Armar estado de la plataforma"

SONDAS = "Sondar n8n y la API de riesgo"
NEON = "Neon: ping y ultimo monitoreo"
JIRA_ABIERTOS = "Jira: tickets abiertos"
JIRA_VENCIDOS = "Jira: tickets con SLA vencido"


def armar(sondas=None, neon=None, abiertos=None, vencidos=None):
    nodos = {
        SONDAS: [sondas if sondas is not None else sondas_ok()],
        NEON: [neon if neon is not None else neon_ok()],
        JIRA_ABIERTOS: [abiertos if abiertos is not None else {"total": 10}],
        JIRA_VENCIDOS: [vencidos if vencidos is not None else {"total": 1}],
    }
    proc = subprocess.run(
        ["node", str(HARNESS), str(WORKFLOW), NODO],
        input=json.dumps({"entrada": [{}], "nodos": nodos}),
        capture_output=True, text=True, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr or proc.stdout
    return json.loads(proc.stdout)[0]


def sondas_ok(n8n="ONLINE", api="ONLINE"):
    return {
        "n8n": {"estado": n8n, "latencia_ms": 45},
        "api": {"estado": api, "latencia_ms": 22,
                "cuerpo": {"status": "ok", "model_version": "riesgo_vial@7",
                           "entrenado": "2026-10-09"}},
        "t_db": int(time.time() * 1000),
    }


def neon_ok(tipo="modelo.monitoreado", dias=0, f1=0.91):
    fecha = datetime.now(timezone.utc) - timedelta(days=dias)
    return {"ok": 1, "tipo": tipo, "fecha": fecha.isoformat(),
            "datos": {"modelo": "riesgo_vial", "version": "7",
                      "psi_max": 0.08, "f1_real": f1,
                      "reporte_url": "https://github.com/x/y/actions/runs/1"}}


def servicio(salida, nombre):
    return next(s for s in salida["servicios"] if s["nombre"] == nombre)


def test_todo_arriba_es_operativo():
    s = armar()
    assert s["estado_plataforma"] == "OPERATIVO"
    assert [x["nombre"] for x in s["servicios"]] == ["n8n_engine", "fastapi_mlops", "neon_postgres"]
    assert servicio(s, "n8n_engine")["latencia_ms"] == 45
    assert all(x["latencia_ms"] is not None for x in s["servicios"])


def test_un_servicio_caido_degrada_la_plataforma():
    s = armar(sondas=sondas_ok(api="OFFLINE"))
    assert s["estado_plataforma"] == "DEGRADADO"
    assert servicio(s, "fastapi_mlops")["estado"] == "OFFLINE"


def test_todo_caido_es_caido():
    s = armar(sondas=sondas_ok(n8n="OFFLINE", api="OFFLINE"), neon={"error": "sin conexion"})
    assert s["estado_plataforma"] == "CAIDO"


def test_neon_no_copia_el_estado_de_la_api():
    # El defecto que tenia antes: db_status = fastapi_status. Con la API arriba
    # y la consulta fallando, Neon tiene que salir OFFLINE igual.
    s = armar(sondas=sondas_ok(api="ONLINE"), neon={"error": "connection refused"})
    assert servicio(s, "fastapi_mlops")["estado"] == "ONLINE"
    assert servicio(s, "neon_postgres")["estado"] == "OFFLINE"
    assert s["estado_plataforma"] == "DEGRADADO"


def test_el_modelo_y_la_version_los_manda_la_api():
    s = armar()
    assert s["monitoreo_modelo"]["modelo"] == "riesgo_vial"
    assert s["monitoreo_modelo"]["version"] == "7"


def test_el_f1_sale_del_ultimo_evento_de_monitoreo():
    s = armar(neon=neon_ok(f1=0.873))
    assert s["monitoreo_modelo"]["f1_score"] == 0.873
    assert s["monitoreo_modelo"]["deriva_detectada"] is False
    assert s["monitoreo_modelo"]["monitoreo_vigente"] is True


def test_si_el_ultimo_evento_es_de_deriva_lo_dice():
    s = armar(neon=neon_ok(tipo="modelo.deriva_detectada"))
    assert s["monitoreo_modelo"]["deriva_detectada"] is True


def test_sin_eventos_de_monitoreo_no_se_inventa_el_f1():
    s = armar(neon={"ok": 1, "tipo": None, "fecha": None, "datos": None})
    m = s["monitoreo_modelo"]
    assert m["f1_score"] is None
    assert m["deriva_detectada"] is None      # no se sabe, no es "no hay deriva"
    assert m["monitoreo_vigente"] is False
    assert m["modelo"] == "riesgo_vial"       # esto si se sabe: lo dice la API
    assert servicio(s, "neon_postgres")["estado"] == "ONLINE"


def test_un_monitoreo_viejo_deja_de_estar_vigente():
    s = armar(neon=neon_ok(dias=30))
    assert s["monitoreo_modelo"]["monitoreo_vigente"] is False
    assert s["monitoreo_modelo"]["ultimo_monitoreo"] is not None


def test_el_cumplimiento_de_sla_se_calcula_con_los_dos_contadores():
    s = armar(abiertos={"total": 10}, vencidos={"total": 1})
    assert s["service_desk_jira"]["tickets_abiertos"] == 10
    assert s["service_desk_jira"]["cumplimiento_sla_porcentaje"] == 90.0


def test_sin_tickets_abiertos_el_cumplimiento_es_100_y_no_divide_entre_cero():
    s = armar(abiertos={"total": 0}, vencidos={"total": 0})
    assert s["service_desk_jira"]["cumplimiento_sla_porcentaje"] == 100


def test_si_jira_falla_el_resto_del_estado_sigue_respondiendo():
    s = armar(abiertos={"error": "401 Unauthorized"}, vencidos={"error": "401 Unauthorized"})
    assert s["estado_plataforma"] == "OPERATIVO"
    assert s["service_desk_jira"]["tickets_abiertos"] is None
    assert s["service_desk_jira"]["cumplimiento_sla_porcentaje"] is None
    assert s["service_desk_jira"]["portal_url"].startswith("https://")


def test_la_respuesta_trae_las_tres_secciones_del_contrato():
    s = armar()
    assert set(s) == {"estado_plataforma", "timestamp", "version",
                      "servicios", "monitoreo_modelo", "service_desk_jira"}
    datetime.fromisoformat(s["timestamp"].replace("Z", "+00:00"))
