from datetime import date

import pytest
from fastapi.testclient import TestClient

import main
from conftest import zona
from model_engine import ModeloCargado, RiskModelEngine

CLAVE = "clave-de-prueba"
CABECERA = {"X-API-Key": CLAVE}


class RepoFalso:
    habilitado = True

    def __init__(self, falla=False):
        self.falla = falla
        self.registros = []

    def guardar(self, registros):
        if self.falla:
            raise ConnectionError("Neon dormido")
        self.registros.extend(registros)

    def comprobar(self):
        return not self.falla


def engine_con(modelo):
    return RiskModelEngine(cargador=lambda *_: ModeloCargado(modelo=modelo, version="7", run_id="abc"))


def engine_sin_modelo():
    def falla(*_):
        raise LookupError("alias champion no existe")
    return RiskModelEngine(cargador=falla)


@pytest.fixture()
def repo():
    return RepoFalso()


@pytest.fixture()
def cliente(pipeline_ht46, repo):
    app = main.crear_app(engine=engine_con(pipeline_ht46), repo=repo, api_key=CLAVE)
    with TestClient(app) as c:
        yield c


def test_health_es_publico_e_informa_el_modo(cliente):
    r = cliente.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "modo": "modelo", "version_modelo": "7"}


@pytest.mark.parametrize("cabecera", [{}, {"X-API-Key": "otra"}])
def test_predict_exige_api_key(cliente, cabecera):
    assert cliente.post("/predict", json=zona(), headers=cabecera).status_code == 401
    assert cliente.get("/model/info", headers=cabecera).status_code == 401


def test_predict_devuelve_y_registra_la_prediccion(cliente, repo):
    r = cliente.post("/predict", json=zona(), headers=CABECERA)
    assert r.status_code == 200
    cuerpo = r.json()
    assert cuerpo["fuente"] == "modelo"
    assert cuerpo["model_version"] == "7"
    assert cuerpo["registrada"] is True

    [registro] = repo.registros
    assert registro == {
        "zona_id": "Av. Javier Prado / Via Expresa",
        "franja": "tarde",
        "fecha_objetivo": date(2026, 10, 12),
        "variables": {"siniestros_12m": 12, "severidad_media": 1.5, "congestion_media": 45.0, "reportes_30d": 3},
        "nivel": cuerpo["nivel"],
        "probabilidad": cuerpo["probabilidad"],
        "model_version": "7",
    }


def test_lote_predice_todas_las_zonas_en_una_llamada(cliente, repo):
    zonas = [zona(zona_id=f"Z{i}", franja=f) for i in range(20) for f in ("manana", "tarde", "noche")]
    r = cliente.post("/predict/lote", json={"zonas": zonas}, headers=CABECERA)
    assert r.status_code == 200
    assert len(r.json()["predicciones"]) == 60
    assert len(repo.registros) == 60


@pytest.mark.parametrize("cambio", [
    {"franja": "mañana"},           # el dataset de HT-46 usa "manana"
    {"congestion_media": 120},
    {"siniestros_12m": -1},
    {"zona_id": ""},
])
def test_rechaza_entradas_fuera_de_contrato(cliente, cambio):
    assert cliente.post("/predict", json=zona(**cambio), headers=CABECERA).status_code == 422


def test_lote_vacio_o_demasiado_grande(cliente):
    assert cliente.post("/predict/lote", json={"zonas": []}, headers=CABECERA).status_code == 422
    assert cliente.post("/predict/lote", json={"zonas": [zona()] * 501}, headers=CABECERA).status_code == 422


def test_si_neon_falla_responde_igual_pero_avisa(pipeline_ht46):
    app = main.crear_app(engine=engine_con(pipeline_ht46), repo=RepoFalso(falla=True), api_key=CLAVE)
    with TestClient(app) as c:
        r = c.post("/predict", json=zona(), headers=CABECERA)
        assert r.status_code == 200
        assert r.json()["registrada"] is False
        assert c.get("/model/info", headers=CABECERA).json()["registro_predicciones"] is False


def test_sin_modelo_usa_la_heuristica_de_central_vr5(repo):
    app = main.crear_app(engine=engine_sin_modelo(), repo=repo, api_key=CLAVE)
    with TestClient(app) as c:
        cuerpo = c.post("/predict", json=zona(siniestros_12m=12, severidad_media=1.5, congestion_media=45.0),
                        headers=CABECERA).json()
        # 12*0.5=6 (tope) + 2 (severidad) + 2 (congestion > 30) = 10 -> alto
        assert cuerpo["fuente"] == "heuristico"
        assert cuerpo["nivel"] == "alto"
        assert cuerpo["probabilidad"] == 1.0
        assert cuerpo["model_version"] == "heuristico-central-vr5"
        info = c.get("/model/info", headers=CABECERA).json()
        assert info["modo"] == "heuristico"
        assert "champion" in info["motivo_heuristico"]


def test_fallo_del_modelo_en_inferencia_queda_visible(repo):
    class ModeloRoto:
        classes_ = ["alto", "bajo", "medio"]

        def predict_proba(self, X):
            raise ValueError("columnas inesperadas")

    app = main.crear_app(engine=engine_con(ModeloRoto()), repo=repo, api_key=CLAVE)
    with TestClient(app) as c:
        assert c.post("/predict", json=zona(), headers=CABECERA).json()["fuente"] == "heuristico"
        assert "columnas inesperadas" in c.get("/model/info", headers=CABECERA).json()["ultimo_error_inferencia"]


def test_produccion_exige_api_key_y_base_de_datos(monkeypatch, pipeline_ht46):
    monkeypatch.setenv("APP_ENV", "production")
    with pytest.raises(RuntimeError, match="INFERENCE_API_KEY"):
        main.crear_app(engine=engine_con(pipeline_ht46), repo=RepoFalso(), api_key="")

    class SinBase(RepoFalso):
        habilitado = False

    with pytest.raises(RuntimeError, match="DATABASE_URL"):
        main.crear_app(engine=engine_con(pipeline_ht46), repo=SinBase(), api_key=CLAVE)


def test_cors_cerrado_por_defecto(cliente):
    r = cliente.options("/predict", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in r.headers
