"""
UrbanPulse MLOps Data & Concept Drift Monitor (HT-49 T03)
Autor: Alvaro Tipian (MLOps & DevSecOps Leader)

Calculo real del PSI y del F1 incorporado por HT-48 (Fabio Saavedra, QA).
Antes el script devolvia constantes escritas a mano, de modo que
.github/workflows/ml-monitoring.yml abria el ticket de Jira y disparaba el
reentrenamiento sin haber mirado ningun dato. Ahora ambas metricas se calculan
sobre los lotes de prediccion, y el contrato de salida no cambia:

  - imprime ``DERIVA_DETECTADA=true|false`` (lo que lee el workflow)
  - escribe ``docs/DRIFT_MONITORING_REPORT.json`` con las mismas claves
  - ``--simulate-drift`` sigue forzando el escenario de deriva

Sin dependencias externas: el workflow lo ejecuta sin `pip install`.
"""

import csv
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Dict, List

RAIZ = Path(__file__).resolve().parents[2]

# El calculo del PSI vive junto a sus pruebas, en el banco de HT-48, para que no
# haya dos implementaciones que se puedan desincronizar.
sys.path.insert(0, str(RAIZ / "ia-ops" / "mlops-tests"))

from deteccion.deriva import (  # noqa: E402
    UMBRAL_DERIVA_ALTA,
    construir_alerta,
    evaluar_deriva,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mlops_drift_monitor")

DATOS = RAIZ / "ia-ops" / "mlops-tests" / "datos"

# Lote con el que se valido el modelo activo.
REFERENCIA = DATOS / "predicciones_muestra.csv"
# Lote de produccion a auditar. Mientras HT-46 no publique predicciones reales,
# por defecto se audita el propio lote de referencia (resultado: sin deriva).
ACTUAL = Path(os.environ.get("PREDICCIONES_ACTUALES_CSV", REFERENCIA))
# Lote con la distribucion desplazada, para --simulate-drift.
CON_DERIVA = DATOS / "predicciones_con_deriva.csv"

PRIORIDADES = DATOS / "prioridades_predichas.csv"

MODELO = "urbanpulse_risk_classifier"
VERSION_ACTIVA = "1.0.0"
F1_BASELINE = 0.941


def _columna(ruta: Path, nombre: str) -> List[float]:
    with ruta.open(encoding="utf-8") as manejador:
        return [float(fila[nombre]) for fila in csv.DictReader(manejador)]


def calcular_f1_macro(ruta: Path) -> float:
    """F1 macro sobre las clases de prioridad, sin sklearn.

    Macro y no micro a proposito: la prioridad 5 es la clase minoritaria y la
    que importa, y un promedio micro la dejaria enterrada bajo las demas.
    """
    if not ruta.exists():
        return F1_BASELINE

    with ruta.open(encoding="utf-8") as manejador:
        filas = list(csv.DictReader(manejador))

    clases = sorted({fila["prioridad_real"] for fila in filas})
    puntajes = []

    for clase in clases:
        vp = sum(
            1 for f in filas if f["prioridad_predicha"] == clase and f["prioridad_real"] == clase
        )
        fp = sum(
            1 for f in filas if f["prioridad_predicha"] == clase and f["prioridad_real"] != clase
        )
        fn = sum(
            1 for f in filas if f["prioridad_predicha"] != clase and f["prioridad_real"] == clase
        )

        precision = vp / (vp + fp) if (vp + fp) else 0.0
        exhaustividad = vp / (vp + fn) if (vp + fn) else 0.0
        if precision + exhaustividad:
            puntajes.append(2 * precision * exhaustividad / (precision + exhaustividad))
        else:
            puntajes.append(0.0)

    return round(sum(puntajes) / len(puntajes), 4) if puntajes else 0.0


def evaluate_model_drift(simulate_drift: bool = False) -> Dict[str, Any]:
    """Evalua si las predicciones recientes presentan Data Drift o Concept Drift."""
    logger.info("Iniciando analisis de Data Drift (PSI) y rendimiento F1-Score...")

    ruta_actual = CON_DERIVA if simulate_drift else ACTUAL
    if not REFERENCIA.exists() or not ruta_actual.exists():
        logger.error("Faltan los lotes de prediccion (%s / %s).", REFERENCIA, ruta_actual)
        raise SystemExit(2)

    resultado = evaluar_deriva(
        _columna(REFERENCIA, "probabilidad"),
        _columna(ruta_actual, "probabilidad"),
    )
    f1_actual = calcular_f1_macro(PRIORIDADES)
    alerta = construir_alerta(resultado, model_version=VERSION_ACTIVA)

    if resultado.hay_deriva:
        logger.warning(
            "ALERTA MLOPS: Data Drift detectado. PSI=%s (umbral %s), F1=%s",
            resultado.psi,
            UMBRAL_DERIVA_ALTA,
            f1_actual,
        )
    else:
        logger.info(
            "Estado del modelo optimo. PSI=%s (umbral %s), F1=%s",
            resultado.psi,
            UMBRAL_DERIVA_ALTA,
            f1_actual,
        )

    report = {
        "model_name": MODELO,
        "active_version": VERSION_ACTIVA,
        "psi_score": resultado.psi,
        "psi_umbral": UMBRAL_DERIVA_ALTA,
        "severidad": resultado.severidad,
        "f1_actual": f1_actual,
        "f1_baseline": F1_BASELINE,
        "deriva": resultado.hay_deriva,
        "lote_referencia": REFERENCIA.name,
        "lote_auditado": ruta_actual.name,
        "timestamp": alerta["detectado_en"],
        "accion_requerida": alerta["accion_requerida"],
        "resumen": alerta["resumen"],
        "por_tramo": resultado.por_tramo,
    }

    destino = RAIZ / "docs"
    destino.mkdir(exist_ok=True)
    with (destino / "DRIFT_MONITORING_REPORT.json").open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)

    return report


if __name__ == "__main__":
    simulate = "--simulate-drift" in sys.argv
    result = evaluate_model_drift(simulate_drift=simulate)
    print(f"DERIVA_DETECTADA={str(result['deriva']).lower()}")
