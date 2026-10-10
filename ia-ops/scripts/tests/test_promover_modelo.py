import os

import pytest

import promover_modelo as pm
from conftest import RAIZ, panel_sintetico

M = lambda f1, rec: {"f1_macro": f1, "recall_alto": rec}  # noqa: E731


# ---------------------------------------------------------------- reglas

def test_sin_challenger_no_se_promueve():
    d = pm.decidir(None, None, {})
    assert not d.promover


def test_challenger_que_ya_es_champion_no_se_promueve():
    assert not pm.decidir("3", "3", {}).promover


def test_primer_modelo_debe_superar_a_la_heuristica():
    assert pm.decidir("1", None, {"challenger": M(0.50, 0.4), "heuristico": M(0.33, 0.0)}).promover
    # Empate = no supera (el caso real de HT-46 T02: 0.332 vs 0.332).
    assert not pm.decidir("1", None, {"challenger": M(0.332, 0.0), "heuristico": M(0.332, 0.0)}).promover


@pytest.mark.parametrize("challenger, champion, esperado", [
    (M(0.60, 0.50), M(0.55, 0.50), True),
    (M(0.60, 0.50), M(0.60, 0.50), True),    # igual: no empeora
    (M(0.54, 0.60), M(0.55, 0.50), False),   # peor F1
    (M(0.70, 0.40), M(0.55, 0.50), False),   # mejor F1 pero detecta peor "alto"
])
def test_challenger_contra_champion(challenger, champion, esperado):
    d = pm.decidir("5", "4", {"challenger": challenger, "champion": champion, "heuristico": M(0.3, 0.0)})
    assert d.promover is esperado


def test_reporte_markdown_lista_criterios():
    d = pm.decidir("5", "4", {"challenger": M(0.6, 0.5), "champion": M(0.7, 0.5), "heuristico": M(0.3, 0.0)})
    md = pm.reporte_markdown(d)
    assert "NO PROMOVER" in md and "rechazado" in md and "| champion | 0.700 |" in md


# ---------------------------------------------------------------- aliases

@pytest.fixture()
def cliente(registry):
    import mlflow
    from mlflow.tracking import MlflowClient
    from sklearn.dummy import DummyClassifier

    c = MlflowClient()
    for _ in range(3):
        with mlflow.start_run() as run:
            mlflow.sklearn.log_model(DummyClassifier().fit([[0]], ["bajo"]), "model")
        mlflow.register_model(f"runs:/{run.info.run_id}/model", pm.NOMBRE_MODELO)
    return c


def test_promover_guarda_el_champion_anterior(cliente):
    assert pm.promover(cliente, "1") == {"champion": "1", "champion_anterior": None}
    assert pm.promover(cliente, "2", origen="run 9") == {"champion": "2", "champion_anterior": "1"}
    assert pm.version_por_alias(cliente, pm.ALIAS_ANTERIOR) == "1"
    assert cliente.get_model_version(pm.NOMBRE_MODELO, "2").tags["promovido_por"] == "run 9"


def test_rollback_en_un_paso_vuelve_al_anterior(cliente):
    pm.promover(cliente, "1")
    pm.promover(cliente, "2")
    assert pm.rollback(cliente) == {"champion": "1", "champion_anterior": "2"}
    assert pm.version_por_alias(cliente, pm.ALIAS_CHAMPION) == "1"


def test_rollback_a_version_explicita(cliente):
    pm.promover(cliente, "3")
    assert pm.rollback(cliente, "1") == {"champion": "1", "champion_anterior": "3"}


def test_rollback_sin_destino_o_a_version_inexistente_falla(cliente):
    from mlflow.exceptions import MlflowException

    pm.promover(cliente, "1")
    with pytest.raises(SystemExit):
        pm.rollback(cliente)
    with pytest.raises(MlflowException):
        pm.rollback(cliente, "99")


def test_restaurar_tras_despliegue_fallido(cliente):
    pm.promover(cliente, "1")
    pm.promover(cliente, "2")
    pm.restaurar(cliente, "1")
    assert pm.version_por_alias(cliente, pm.ALIAS_CHAMPION) == "1"
    pm.restaurar(cliente, None)
    assert pm.version_por_alias(cliente, pm.ALIAS_CHAMPION) is None


# ---------------------------------------- evaluacion con ml/train/train.py real

ML_TRAIN = os.path.join(RAIZ, "ml", "train")
requiere_ht46 = pytest.mark.skipif(
    not os.path.exists(os.path.join(ML_TRAIN, "train.py")),
    reason="ml/train/train.py (HT-46) todavia no esta en esta rama",
)


def entrenar_con_train_py(tmp_path, senal: bool, semilla: int = 0) -> str:
    """Corre el main() real de train.py sobre un panel sintetico; registra
    riesgo_vial con alias challenger, igual que en produccion."""
    import importlib
    import sys

    sys.path.insert(0, ML_TRAIN)
    import train

    importlib.reload(train)
    ruta = tmp_path / f"dataset_{semilla}.parquet"
    panel_sintetico(semilla=semilla, senal=senal).to_parquet(ruta)
    sys.argv = ["train.py", "--fecha-corte", "2025-03-31", "--dataset", str(ruta)]
    train.main()
    return str(ruta)


@requiere_ht46
def test_evaluar_promueve_un_modelo_que_supera_a_la_heuristica(registry, tmp_path):
    dataset = entrenar_con_train_py(tmp_path, senal=True)
    salida = tmp_path / "rep"
    gh = tmp_path / "gh_output"
    os.environ["GITHUB_OUTPUT"] = str(gh)
    try:
        assert pm.main(["evaluar", "--fecha-corte", "2025-03-31", "--dataset", dataset,
                        "--ml-train", ML_TRAIN, "--salida", str(salida)]) == 0
    finally:
        del os.environ["GITHUB_OUTPUT"]
    assert "promover=true" in gh.read_text()
    assert (salida / "decision_promocion.md").exists()


@requiere_ht46
def test_evaluar_no_promueve_ruido(registry, tmp_path):
    dataset = entrenar_con_train_py(tmp_path, senal=False)
    from mlflow.tracking import MlflowClient

    challenger = pm.version_por_alias(MlflowClient(), pm.ALIAS_CHALLENGER)
    train = pm.importar_train(ML_TRAIN)
    metricas = pm.evaluar_en_validacion(train, "2025-03-31", dataset, pm.cargar_desde_registry,
                                        {"challenger": challenger, "champion": None})
    assert not pm.decidir(challenger, None, metricas).promover
