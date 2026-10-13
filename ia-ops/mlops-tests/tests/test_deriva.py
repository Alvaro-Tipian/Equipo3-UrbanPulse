"""Deteccion de deriva con un lote derivado a proposito (HT-48 CA5).

Comprueba que el monitoreo detecta la deriva y emite una alerta accionable. El
ticket en Jira y el disparo del reentrenamiento los hace el flujo de n8n de
HT-49; lo que se verifica aqui es que la senal que ese flujo consume llegue
completa, porque es la parte que puede romperse desde este lado sin que nadie
se entere hasta que haya una deriva real.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pandas as pd
import pytest

from deteccion.deriva import (
    UMBRAL_DERIVA_ALTA,
    calcular_psi,
    construir_alerta,
    evaluar_deriva,
)

# Campos que el flujo de HT-49 necesita para abrir el ticket y lanzar el
# reentrenamiento sin volver a consultar nada.
CAMPOS_DE_LA_ALERTA = {
    "tipo",
    "hay_deriva",
    "severidad",
    "variable",
    "psi",
    "umbral",
    "model_version",
    "detectado_en",
    "accion_requerida",
    "resumen",
}


def test_un_lote_identico_no_tiene_deriva(predicciones: pd.DataFrame) -> None:
    """El PSI de un lote contra si mismo es cero: sin esto, todo lo demas sobra."""
    assert calcular_psi(predicciones["probabilidad"], predicciones["probabilidad"]) == pytest.approx(
        0.0, abs=1e-9
    )


def test_no_se_alerta_sobre_el_lote_estable(predicciones: pd.DataFrame) -> None:
    """Una mitad del lote contra la otra no debe disparar la alarma.

    Es la prueba de falsos positivos: si el detector marcara deriva entre dos
    mitades del mismo lote, en produccion abriria tickets cada semana y el
    equipo dejaria de hacerle caso.
    """
    mitad = len(predicciones) // 2
    resultado = evaluar_deriva(
        predicciones["probabilidad"].iloc[:mitad], predicciones["probabilidad"].iloc[mitad:]
    )

    assert not resultado.hay_deriva, (
        f"Falso positivo: PSI {resultado.psi} entre dos mitades del mismo lote."
    )


def test_se_detecta_la_deriva_simulada(
    predicciones: pd.DataFrame, predicciones_con_deriva: pd.DataFrame
) -> None:
    resultado = evaluar_deriva(
        predicciones["probabilidad"], predicciones_con_deriva["probabilidad"]
    )

    assert resultado.hay_deriva, (
        f"No se detecto la deriva simulada: PSI {resultado.psi}, por debajo del "
        f"umbral {UMBRAL_DERIVA_ALTA}."
    )
    assert resultado.severidad == "alta"


def test_la_deriva_pasa_inadvertida_fila_a_fila(
    predicciones_con_deriva: pd.DataFrame,
) -> None:
    """Justifica que exista este detector.

    El lote derivado supera las validaciones por fila: cada probabilidad sigue
    en rango y cada nivel sigue siendo coherente con su probabilidad. Si una
    validacion fila a fila lo atrapara, el monitoreo de distribucion no haria
    falta.
    """
    assert predicciones_con_deriva["probabilidad"].between(0, 1).all()

    esperado = pd.cut(
        predicciones_con_deriva["probabilidad"],
        bins=[0.0, 0.4, 0.7, 1.001],
        labels=["bajo", "medio", "alto"],
        right=False,
    ).astype(str)
    assert (predicciones_con_deriva["nivel"] == esperado).all()


def test_la_alerta_lleva_todo_lo_que_necesita_el_ticket(
    predicciones: pd.DataFrame, predicciones_con_deriva: pd.DataFrame
) -> None:
    resultado = evaluar_deriva(
        predicciones["probabilidad"], predicciones_con_deriva["probabilidad"]
    )
    alerta = construir_alerta(resultado, model_version="riesgo-vial-0.1.0")

    faltantes = CAMPOS_DE_LA_ALERTA - set(alerta)
    assert not faltantes, f"La alerta no trae: {', '.join(sorted(faltantes))}"

    assert alerta["hay_deriva"] is True
    assert alerta["accion_requerida"] == "reentrenar"
    assert alerta["model_version"] == "riesgo-vial-0.1.0"
    assert str(resultado.psi) in alerta["resumen"]


def _correr_monitor(*argumentos: str) -> tuple[str, dict]:
    """Ejecuta el monitor de HT-49 como lo hace el workflow: por linea de comandos."""
    raiz = Path(__file__).resolve().parents[3]
    proceso = subprocess.run(
        [sys.executable, str(raiz / "ia-ops" / "scripts" / "monitor_drift.py"), *argumentos],
        capture_output=True,
        text=True,
        cwd=raiz,
    )
    assert proceso.returncode == 0, f"El monitor fallo:\n{proceso.stderr}"

    reporte = json.loads(
        (raiz / "docs" / "DRIFT_MONITORING_REPORT.json").read_text(encoding="utf-8")
    )
    return proceso.stdout, reporte


def test_el_monitoreo_de_ht49_detecta_la_deriva_simulada() -> None:
    """CA5: con deriva simulada, el monitoreo abre el ticket y lanza el reentrenamiento.

    Se ejecuta el script por linea de comandos, igual que
    .github/workflows/ml-monitoring.yml, porque lo que gobierna ese flujo es la
    linea `DERIVA_DETECTADA=`: el paso que crea el ticket en Jira y el que
    dispara mlops-pipeline.yml estan ambos condicionados a ella. Si el formato
    de esa linea cambiara, los dos pasos dejarian de ejecutarse en silencio y
    una deriva real pasaria sin que nadie se entere.
    """
    salida, reporte = _correr_monitor("--simulate-drift")

    assert "DERIVA_DETECTADA=true" in salida, (
        "El workflow de HT-49 no veria la deriva: no se emitio DERIVA_DETECTADA=true."
    )
    assert reporte["deriva"] is True
    assert reporte["accion_requerida"] == "reentrenar"
    assert reporte["psi_score"] > reporte["psi_umbral"]


def test_el_monitoreo_de_ht49_calla_sin_deriva() -> None:
    """Sin deriva no debe abrirse ticket ni dispararse reentrenamiento."""
    salida, reporte = _correr_monitor()

    assert "DERIVA_DETECTADA=false" in salida
    assert reporte["deriva"] is False
    assert reporte["accion_requerida"] == "ninguna"


def test_el_reporte_de_ht49_conserva_sus_claves() -> None:
    """El reporte alimenta el summary y el artefacto del workflow de HT-49."""
    _, reporte = _correr_monitor()

    esperadas = {"model_name", "active_version", "psi_score", "f1_actual", "f1_baseline", "deriva"}
    faltantes = esperadas - set(reporte)
    assert not faltantes, f"El reporte perdio claves que HT-49 consume: {sorted(faltantes)}"


def test_sin_deriva_no_se_pide_reentrenamiento(predicciones: pd.DataFrame) -> None:
    """La alerta tambien tiene que saber callarse."""
    mitad = len(predicciones) // 2
    resultado = evaluar_deriva(
        predicciones["probabilidad"].iloc[:mitad], predicciones["probabilidad"].iloc[mitad:]
    )
    alerta = construir_alerta(resultado, model_version="riesgo-vial-0.1.0")

    assert alerta["hay_deriva"] is False
    assert alerta["accion_requerida"] == "ninguna"
