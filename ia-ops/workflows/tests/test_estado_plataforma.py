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
JIRA_DEL_MES = "Jira: tickets del mes con SLA"
JIRA_VENCIDOS = "Jira: tickets con SLA vencido"
GITHUB = "GitHub: ultimo despliegue"


def armar(sondas=None, neon=None, abiertos=None, del_mes=None, vencidos=None, github=None):
    nodos = {
        SONDAS: [sondas if sondas is not None else sondas_ok()],
        NEON: [neon if neon is not None else neon_ok()],
        JIRA_ABIERTOS: [abiertos if abiertos is not None else {"count": 3}],
        JIRA_DEL_MES: [del_mes if del_mes is not None else {"count": 10}],
        JIRA_VENCIDOS: [vencidos if vencidos is not None else {"count": 1}],
        GITHUB: [github if github is not None else github_ok()],
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


def github_ok():
    return {"errores": [], "despliegues": [
        {"workflow": "Deploy n8n to AWS Lightsail", "fecha": "2026-10-13T18:02:11Z",
         "commit": "6e4c358", "url": "https://github.com/x/y/actions/runs/121"},
        {"workflow": "MLOps - Despliegue de la API de riesgo vial", "fecha": "2026-10-14T21:40:05Z",
         "commit": "e24aedf", "url": "https://github.com/x/y/actions/runs/130"},
    ]}


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


def test_el_cumplimiento_de_sla_es_el_del_mes():
    # Criterio 3 de HU-13: de los tickets del mes con SLA, cuantos no vencieron.
    # Los tickets abiertos son otro dato y no entran en el porcentaje.
    s = armar(abiertos={"count": 3}, del_mes={"count": 10}, vencidos={"count": 1})
    assert s["service_desk_jira"]["tickets_abiertos"] == 3
    assert s["service_desk_jira"]["cumplimiento_sla_porcentaje"] == 90.0


def test_sin_tickets_del_mes_el_cumplimiento_es_100_y_no_divide_entre_cero():
    s = armar(del_mes={"count": 0}, vencidos={"count": 0})
    assert s["service_desk_jira"]["cumplimiento_sla_porcentaje"] == 100


def test_si_falla_el_contador_del_mes_el_sla_no_se_inventa():
    s = armar(del_mes={"error": "400 campo de SLA inexistente"})
    assert s["service_desk_jira"]["cumplimiento_sla_porcentaje"] is None
    assert s["service_desk_jira"]["tickets_abiertos"] == 3


def test_el_ultimo_despliegue_es_el_mas_reciente_de_los_dos_workflows():
    d = armar()["ultimo_despliegue"]
    assert d == {"fecha": "2026-10-14T21:40:05.000Z", "commit": "e24aedf",
                 "workflow": "MLOps - Despliegue de la API de riesgo vial",
                 "url": "https://github.com/x/y/actions/runs/130"}


def test_si_github_no_responde_el_despliegue_sale_en_null():
    s = armar(github={"despliegues": [], "errores": ["timeout"]})
    assert s["ultimo_despliegue"] is None
    assert s["estado_plataforma"] == "OPERATIVO"


def test_el_motivo_del_monitoreo_sin_datos_llega_al_operador():
    neon = neon_ok()
    neon["datos"].update({"version": None, "f1_real": None, "psi_max": None,
                          "motivo": "Sin predicciones suficientes para medir la deriva."})
    m = armar(neon=neon)["monitoreo_modelo"]
    assert m["f1_score"] is None
    assert m["observacion"] == "Sin predicciones suficientes para medir la deriva."
    assert m["version"] == "7"            # la sigue diciendo la API
    assert m["monitoreo_vigente"] is True


def test_si_jira_falla_el_resto_del_estado_sigue_respondiendo():
    s = armar(abiertos={"error": "401 Unauthorized"}, del_mes={"error": "401 Unauthorized"},
              vencidos={"error": "401 Unauthorized"})
    assert s["estado_plataforma"] == "OPERATIVO"
    assert s["service_desk_jira"]["tickets_abiertos"] is None
    assert s["service_desk_jira"]["cumplimiento_sla_porcentaje"] is None
    assert s["service_desk_jira"]["portal_url"].startswith("https://")


def test_la_respuesta_trae_las_tres_secciones_del_contrato():
    s = armar()
    assert set(s) == {"estado_plataforma", "timestamp", "version", "servicios",
                      "ultimo_despliegue", "monitoreo_modelo", "service_desk_jira"}
    datetime.fromisoformat(s["timestamp"].replace("Z", "+00:00"))


def test_tambien_lee_el_total_del_endpoint_anterior():
    s = armar(abiertos={"total": 4}, del_mes={"total": 4}, vencidos={"total": 1})
    assert s["service_desk_jira"]["tickets_abiertos"] == 4
    assert s["service_desk_jira"]["cumplimiento_sla_porcentaje"] == 75.0


# --- Estructura del workflow ---------------------------------------------

def workflow():
    return json.loads(WORKFLOW.read_text(encoding="utf-8"))


def siguiente(wf, nombre):
    [[destino]] = wf["connections"][nombre]["main"]
    return destino["node"]


def test_jira_cuenta_con_approximate_count():
    # /rest/api/3/search fue retirado de Jira Cloud: con el, los dos
    # contadores salian siempre en null en produccion.
    wf = workflow()
    for nombre in (JIRA_ABIERTOS, JIRA_DEL_MES, JIRA_VENCIDOS):
        p = next(n for n in wf["nodes"] if n["name"] == nombre)["parameters"]
        assert p["method"] == "POST"
        assert p["url"].endswith("/rest/api/3/search/approximate-count")
        assert json.loads(p["jsonBody"])["jql"].startswith("project = UPTI AND ")


def test_el_sla_cuenta_solo_los_tickets_del_mes():
    wf = workflow()
    jql = lambda nombre: json.loads(next(n for n in wf["nodes"] if n["name"] == nombre)
                                    ["parameters"]["jsonBody"])["jql"]
    assert "created >= startOfMonth()" in jql(JIRA_DEL_MES)
    assert "created >= startOfMonth()" in jql(JIRA_VENCIDOS)
    assert '"Tiempo de primera respuesta" = breached()' in jql(JIRA_VENCIDOS)
    # Funciones de SLA documentadas por Atlassian (no "IS NOT EMPTY"), sobre
    # el SLA que de verdad existe en el portal UPTI.
    assert '"Tiempo de primera respuesta" = completed()' in jql(JIRA_DEL_MES)


def test_el_webhook_admite_llamadas_desde_el_navegador():
    # La pantalla de Ajustes (Vercel) lo llama desde el navegador con
    # Authorization, que dispara un preflight CORS. Desde HT-36 T02 solo los
    # orígenes de la app (la lista completa la prueba test_cors_webhooks.py).
    wh = next(n for n in workflow()["nodes"] if n["type"].endswith(".webhook"))
    assert wh["typeVersion"] >= 2
    origenes = wh["parameters"]["options"]["allowedOrigins"].split(",")
    assert "https://equipo3-urban-pulse.vercel.app" in origenes
    assert "http://localhost:5178" in origenes  # mf-ajustes
    assert "*" not in origenes


def test_la_latencia_de_neon_no_incluye_a_jira():
    # "Sondar" toma t_db; entre el y "Armar" solo puede estar la consulta a
    # Neon. Antes Jira iba en medio y Neon reportaba 7 s.
    wf = workflow()
    assert siguiente(wf, SONDAS) == NEON
    assert siguiente(wf, NEON) == NODO
    assert siguiente(wf, "Webhook GET /estado-plataforma") == JIRA_ABIERTOS
    assert siguiente(wf, JIRA_ABIERTOS) == JIRA_DEL_MES
    assert siguiente(wf, JIRA_DEL_MES) == JIRA_VENCIDOS
    assert siguiente(wf, JIRA_VENCIDOS) == GITHUB
    assert siguiente(wf, GITHUB) == SONDAS


def test_la_copia_de_produccion_es_identica():
    prod = RAIZ / "src" / "n8n-workflows" / "production" / "urbanpulse-estado-plataforma.json"
    assert json.loads(prod.read_text(encoding="utf-8")) == workflow()
