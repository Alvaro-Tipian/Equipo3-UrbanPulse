import pandas as pd
import pytest

from conftest import panel_sintetico
from validar_dataset_riesgo import main, validar

CORTE = pd.Timestamp("2025-03-31")


def test_panel_correcto_pasa():
    assert validar(panel_sintetico(), CORTE, min_filas=100, min_zonas=5) == []


@pytest.mark.parametrize("romper, mensaje", [
    (lambda df: df.drop(columns=["reportes_30d"]), "Faltan columnas"),
    (lambda df: df.assign(franja="mañana"), "Franjas fuera de catalogo"),
    (lambda df: df.assign(nivel_riesgo="critico"), "Niveles fuera de catalogo"),
    (lambda df: df.assign(siniestros_12m=-1), "negativos en siniestros_12m"),
    (lambda df: df.assign(congestion_media=150.0), "mayor a 100%"),
    (lambda df: df.assign(dia_semana=9), "dia_semana"),
    (lambda df: df.assign(zona_id=None), "nulos en zona_id"),
    (lambda df: df.head(10), "Solo hay 10 filas"),
])
def test_cada_defecto_detiene_el_pipeline(romper, mensaje):
    errores = validar(romper(panel_sintetico()), CORTE, min_filas=100, min_zonas=5)
    assert any(mensaje in e for e in errores), errores


def test_validacion_solo_con_bajo_se_rechaza():
    # Caso real de ml/README.md: fecha de corte dentro del rezago del ONSV.
    df = panel_sintetico()
    corte_val = CORTE - pd.Timedelta(weeks=8)
    df.loc[df["semana_corte"] >= corte_val, "nivel_riesgo"] = "bajo"
    errores = validar(df, CORTE, min_filas=100, min_zonas=5)
    assert any("solo tiene nivel 'bajo'" in e for e in errores)


def test_semanas_posteriores_al_corte():
    errores = validar(panel_sintetico(), pd.Timestamp("2025-01-01"), min_filas=100, min_zonas=5)
    assert any("posteriores a la fecha de corte" in e for e in errores)


def test_cli_devuelve_1_si_no_existe_el_dataset(tmp_path):
    assert main(["--fecha-corte", "2025-03-31", "--dataset", str(tmp_path / "no.parquet")]) == 1


def test_cli_escribe_el_resumen(tmp_path):
    ruta = tmp_path / "d.parquet"
    panel_sintetico().to_parquet(ruta)
    salida = tmp_path / "rep"
    assert main(["--fecha-corte", "2025-03-31", "--dataset", str(ruta), "--min-filas", "100",
                 "--min-zonas", "5", "--salida", str(salida)]) == 0
    assert (salida / "validacion_dataset.json").exists()
