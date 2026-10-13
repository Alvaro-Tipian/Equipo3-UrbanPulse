"""
Validacion del dataset de riesgo vial antes de entrenar (HT-47 T03, paso
"validar datos").

Revisa el parquet que genera ml/data/build_dataset.py (HT-46 T01) contra lo
que documenta ml/README.md, y se detiene con codigo 1 si algo impide entrenar
o evaluar con sentido. No reemplaza a la suite de Great Expectations de HT-48
(que valida el dataset de reportes ciudadanos): esta mira el panel
zona x franja x dia que consume el modelo de riesgo.

Uso:
  python ia-ops/scripts/validar_dataset_riesgo.py --fecha-corte 2025-03-31
"""

import argparse
import json
import os
import sys
from typing import List, Optional

import pandas as pd

COLUMNAS = [
    "zona_id", "franja", "dia_semana", "siniestros_12m", "severidad_media",
    "congestion_media", "reportes_30d", "nivel_riesgo", "semana_corte",
]
FRANJAS = {"manana", "tarde", "noche"}
NIVELES = {"bajo", "medio", "alto"}
NO_NEGATIVAS = ["siniestros_12m", "severidad_media", "congestion_media", "reportes_30d"]
SEMANAS_VALIDACION = 8  # mismo split temporal que build_dataset.py y train.py


def validar(df: pd.DataFrame, fecha_corte: pd.Timestamp, min_filas: int, min_zonas: int) -> List[str]:
    errores: List[str] = []

    faltantes = [c for c in COLUMNAS if c not in df.columns]
    if faltantes:
        return [f"Faltan columnas: {faltantes}"]

    if len(df) < min_filas:
        errores.append(f"Solo hay {len(df)} filas (minimo {min_filas})")
    zonas = df["zona_id"].nunique()
    if zonas < min_zonas:
        errores.append(f"Solo hay {zonas} zonas (minimo {min_zonas})")

    nulos = df[["zona_id", "franja", "dia_semana", "nivel_riesgo", "semana_corte"]].isna().sum()
    for col, n in nulos.items():
        if n:
            errores.append(f"{n} nulos en {col}")

    franjas = set(df["franja"].dropna().astype(str)) - FRANJAS
    if franjas:
        errores.append(f"Franjas fuera de catalogo: {sorted(franjas)}")
    niveles = set(df["nivel_riesgo"].dropna().astype(str)) - NIVELES
    if niveles:
        errores.append(f"Niveles fuera de catalogo: {sorted(niveles)}")
    if not df["dia_semana"].dropna().between(0, 6).all():
        errores.append("dia_semana fuera de 0-6")
    for col in NO_NEGATIVAS:
        if (df[col].dropna() < 0).any():
            errores.append(f"Valores negativos en {col}")
    if (df["congestion_media"].dropna() > 100).any():
        errores.append("congestion_media mayor a 100%")

    semanas = pd.to_datetime(df["semana_corte"])
    if semanas.max() > fecha_corte:
        errores.append(f"Hay semanas posteriores a la fecha de corte ({semanas.max().date()} > {fecha_corte.date()})")

    corte_val = fecha_corte - pd.Timedelta(weeks=SEMANAS_VALIDACION)
    train = df[semanas < corte_val]
    val = df[semanas >= corte_val]
    if train.empty or val.empty:
        errores.append(f"Split temporal vacio (train={len(train)}, val={len(val)})")
    else:
        # ml/README.md: con una fecha de corte dentro del rezago del ONSV la
        # validacion queda sin "medio"/"alto" y el F1-macro deja de medir algo.
        clases_val = set(val["nivel_riesgo"].astype(str))
        if clases_val <= {"bajo"}:
            errores.append(
                "La validacion solo tiene nivel 'bajo': la fecha de corte cae en el periodo sin reporte "
                "completo del ONSV (ver ml/README.md). Usa una fecha de corte anterior."
            )
        if set(train["nivel_riesgo"].astype(str)) <= {"bajo"}:
            errores.append("El entrenamiento solo tiene nivel 'bajo'")

    return errores


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fecha-corte", required=True)
    parser.add_argument("--dataset", default=None)
    parser.add_argument("--min-filas", type=int, default=1000)
    parser.add_argument("--min-zonas", type=int, default=10)
    parser.add_argument("--salida", default="reportes-mlops")
    args = parser.parse_args(argv)

    fecha_corte = pd.Timestamp(args.fecha_corte)
    ruta = args.dataset or f"ml/data/output/dataset_{fecha_corte.date()}.parquet"
    if not os.path.exists(ruta):
        print(f"::error::No existe {ruta}. Corre antes ml/data/build_dataset.py --fecha-corte {fecha_corte.date()}")
        return 1
    df = pd.read_parquet(ruta)
    errores = validar(df, fecha_corte, args.min_filas, args.min_zonas)

    resumen = {
        "dataset": ruta,
        "filas": len(df),
        "zonas": int(df["zona_id"].nunique()) if "zona_id" in df else 0,
        "distribucion_nivel": df["nivel_riesgo"].astype(str).value_counts().to_dict() if "nivel_riesgo" in df else {},
        "errores": errores,
    }
    os.makedirs(args.salida, exist_ok=True)
    with open(os.path.join(args.salida, "validacion_dataset.json"), "w", encoding="utf-8") as f:
        json.dump(resumen, f, indent=2, ensure_ascii=False)

    if errores:
        for e in errores:
            print(f"::error::{e}")
        return 1
    print(f"Dataset valido: {resumen['filas']} filas, {resumen['zonas']} zonas, {resumen['distribucion_nivel']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
