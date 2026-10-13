"""
Construye el dataset de riesgo vial (zona x franja x dia_semana) para
entrenar el modelo de HT-46, a partir de datos ya existentes en Neon.

Fuentes usadas:
  - siniestros_fatales (ONSV, Lima): tiene lat/lon reales -> define zonas.
  - puntos_monitoreo: catalogo de zonas (son los puntos de TomTom).
  - traffic_readings: congestion por punto (TomTom).
  - reports: reportes ciudadanos (lat/lon) -> reportes_30d.

Fuente excluida:
  - siniestros_sutran: sin geocodificar (0/8079 filas con geom al
    05/10/2026). Ver ml/README.md.

Uso:
  python ml/data/build_dataset.py --fecha-corte 2026-10-05
"""
import argparse
import hashlib
import os

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from sklearn.neighbors import BallTree
from sqlalchemy import create_engine

load_dotenv()

RADIO_TIERRA_KM = 6371.0
RADIO_MAX_ASIGNACION_KM = 3.0
VENTANA_TRAILING_DIAS = 365
VENTANA_REPORTES_DIAS = 30
HORIZONTE_ETIQUETA_DIAS = 7


from urllib.parse import quote_plus

def get_engine():
    url = os.environ.get("DATABASE_URL")
    if not url:
        host = os.environ["DB_HOST"]
        port = os.environ.get("DB_PORT", "5432")
        db = os.environ["DB_DATABASE"]
        user = os.environ["DB_USER"]
        password = quote_plus(os.environ["DB_PASSWORD"])
        url = f"postgresql://{user}:{password}@{host}:{port}/{db}?sslmode=require"
    return create_engine(url)


def derive_franja(hora_str: str) -> str:
    if pd.isna(hora_str):
        return None
    h = int(str(hora_str).split(":")[0])
    if 6 <= h < 12:
        return "manana"
    if 12 <= h < 18:
        return "tarde"
    return "noche"


def load_zonas(engine) -> pd.DataFrame:
    df = pd.read_sql(
        'SELECT nombre AS zona_id, latitude, longitude FROM puntos_monitoreo',
        engine,
    )
    return df.dropna(subset=["latitude", "longitude"]).reset_index(drop=True)


def load_siniestros_fatales(engine) -> pd.DataFrame:
    df = pd.read_sql(
        """
        SELECT codigo_siniestro, fecha_iso AS fecha, hora_siniestro,
               fallecidos, lesionados, tipo_via, distrito, latitud, longitud
        FROM siniestros_fatales
        WHERE departamento = 'LIMA'
          AND latitud IS NOT NULL AND longitud IS NOT NULL
          AND fecha_iso IS NOT NULL
        """,
        engine,
    )
    df["fecha"] = pd.to_datetime(df["fecha"])
    df["franja"] = df["hora_siniestro"].apply(derive_franja)
    df["dia_semana"] = df["fecha"].dt.dayofweek
    df["severidad"] = df["fallecidos"].fillna(0) + df["lesionados"].fillna(0)
    return df.dropna(subset=["franja"])


def load_reports(engine) -> pd.DataFrame:
    df = pd.read_sql(
        """
        SELECT id, created_at, latitude, longitude
        FROM reports
        WHERE latitude IS NOT NULL AND longitude IS NOT NULL
        """,
        engine,
    )
    df["created_at"] = pd.to_datetime(df["created_at"], utc=True).dt.tz_localize(None)
    return df


def load_traffic(engine) -> pd.DataFrame:
    df = pd.read_sql(
        """
        SELECT punto_nombre AS zona_id, porcentaje_congestion, captured_at
        FROM traffic_readings
        WHERE porcentaje_congestion IS NOT NULL
        """,
        engine,
    )
    df["captured_at"] = pd.to_datetime(df["captured_at"], utc=True).dt.tz_localize(None)
    df["franja"] = df["captured_at"].dt.hour.apply(
        lambda h: "manana" if 6 <= h < 12 else ("tarde" if 12 <= h < 18 else "noche")
    )
    return df


def build_tree(zonas: pd.DataFrame) -> BallTree:
    coords_rad = np.radians(zonas[["latitude", "longitude"]].values)
    return BallTree(coords_rad, metric="haversine")


def asignar_zona(df: pd.DataFrame, lat_col: str, lon_col: str, zonas: pd.DataFrame, tree: BallTree):
    coords_rad = np.radians(df[[lat_col, lon_col]].values)
    dist_rad, idx = tree.query(coords_rad, k=1)
    dist_km = dist_rad[:, 0] * RADIO_TIERRA_KM
    df = df.copy()
    df["zona_id"] = zonas["zona_id"].values[idx[:, 0]]
    df["dist_km"] = dist_km
    asignados = df[df["dist_km"] <= RADIO_MAX_ASIGNACION_KM].drop(columns=["dist_km"])
    descartados = len(df) - len(asignados)
    return asignados, descartados


def congestion_por_zona_franja(traffic: pd.DataFrame) -> pd.DataFrame:
    return (
        traffic.groupby(["zona_id", "franja"])["porcentaje_congestion"]
        .mean()
        .reset_index()
        .rename(columns={"porcentaje_congestion": "congestion_media"})
    )


def moda_segura(serie: pd.Series):
    m = serie.mode()
    return m.iloc[0] if not m.empty else None


def build_panel(siniestros, reports, congestion, fecha_corte):
    combinaciones = siniestros[["zona_id", "franja", "dia_semana"]].drop_duplicates()
    semanas = pd.date_range(
        start=siniestros["fecha"].min() + pd.Timedelta(days=VENTANA_TRAILING_DIAS),
        end=fecha_corte - pd.Timedelta(days=HORIZONTE_ETIQUETA_DIAS),
        freq="W-MON",
    )
    filas = []
    for semana in semanas:
        ini_trailing = semana - pd.Timedelta(days=VENTANA_TRAILING_DIAS)
        ventana = siniestros[(siniestros["fecha"] >= ini_trailing) & (siniestros["fecha"] < semana)]
        siguiente = siniestros[
            (siniestros["fecha"] >= semana)
            & (siniestros["fecha"] < semana + pd.Timedelta(days=HORIZONTE_ETIQUETA_DIAS))
        ]
        ini_reportes = semana - pd.Timedelta(days=VENTANA_REPORTES_DIAS)
        reportes_ventana = reports[(reports["created_at"] >= ini_reportes) & (reports["created_at"] < semana)]

        agg_trailing = (
            ventana.groupby(["zona_id", "franja", "dia_semana"])
            .agg(siniestros_12m=("codigo_siniestro", "count"),
                 severidad_media=("severidad", "mean"),
                 tipo_via_frecuente=("tipo_via", moda_segura),
                 distrito=("distrito", moda_segura))
            .reset_index()
        )
        agg_siguiente = (
            siguiente.groupby(["zona_id", "franja", "dia_semana"])["codigo_siniestro"]
            .count()
            .reset_index(name="siniestros_semana_siguiente")
        )
        reportes_por_zona = (
            reportes_ventana.groupby("zona_id")["id"].count().reset_index(name="reportes_30d")
        )

        panel_semana = combinaciones.merge(agg_trailing, on=["zona_id", "franja", "dia_semana"], how="left")
        panel_semana = panel_semana.merge(agg_siguiente, on=["zona_id", "franja", "dia_semana"], how="left")
        panel_semana = panel_semana.merge(reportes_por_zona, on="zona_id", how="left")
        panel_semana = panel_semana.merge(congestion, on=["zona_id", "franja"], how="left")
        panel_semana["semana_corte"] = semana
        filas.append(panel_semana)

    panel = pd.concat(filas, ignore_index=True)
    for col in ["siniestros_12m", "siniestros_semana_siguiente", "reportes_30d"]:
        panel[col] = panel[col].fillna(0).astype(int)
    panel["severidad_media"] = panel["severidad_media"].fillna(0.0)
    panel["congestion_media"] = panel["congestion_media"].fillna(panel["congestion_media"].mean())
    return panel


def split_temporal(panel: pd.DataFrame, fecha_corte: pd.Timestamp):
    corte_val = fecha_corte - pd.Timedelta(weeks=8)
    train = panel[panel["semana_corte"] < corte_val].copy()
    val = panel[panel["semana_corte"] >= corte_val].copy()
    return train, val


def etiquetar_nivel_riesgo(panel: pd.DataFrame) -> pd.DataFrame:
    # siniestros_semana_siguiente solo toma valores 0, 1, 2 en la practica
    # (evento muy raro): 0 = bajo, 1 = medio, 2+ = alto. Un qcut por
    # percentiles colapsa en una sola clase porque >99% de los casos son 0,
    # asi que se usan cortes fijos en vez de cuantiles dinamicos.
    panel = panel.copy()
    bins = [-1, 0, 1, np.inf]
    etiquetas = ["bajo", "medio", "alto"]
    panel["nivel_riesgo"] = pd.cut(panel["siniestros_semana_siguiente"], bins=bins, labels=etiquetas)
    return panel


def guardar_con_hash(df: pd.DataFrame, ruta: str) -> str:
    df.to_parquet(ruta, index=False)
    with open(ruta, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--fecha-corte", required=True,
        help="Fecha de corte fija, formato YYYY-MM-DD (para reproducibilidad)",
    )
    args = parser.parse_args()
    fecha_corte = pd.Timestamp(args.fecha_corte)

    engine = get_engine()
    zonas = load_zonas(engine)
    tree = build_tree(zonas)

    siniestros_raw = load_siniestros_fatales(engine)
    siniestros, descartados_siniestros = asignar_zona(siniestros_raw, "latitud", "longitud", zonas, tree)

    reports_raw = load_reports(engine)
    reports, descartados_reportes = asignar_zona(reports_raw, "latitude", "longitude", zonas, tree)

    traffic = load_traffic(engine)
    congestion = congestion_por_zona_franja(traffic)

    panel = build_panel(siniestros, reports, congestion, fecha_corte)
    panel = etiquetar_nivel_riesgo(panel)
    train, val = split_temporal(panel, fecha_corte)

    os.makedirs("ml/data/output", exist_ok=True)
    ruta = f"ml/data/output/dataset_{fecha_corte.date()}.parquet"
    sha256 = guardar_con_hash(panel, ruta)

    print(f"Fecha de corte: {fecha_corte.date()} (fija, para reproducibilidad)")
    print(f"Dataset guardado en {ruta}")
    print(f"SHA-256: {sha256}")
    print(f"Filas totales: {len(panel)} | train: {len(train)} | val: {len(val)}")
    print(f"Zonas cubiertas: {panel['zona_id'].nunique()} de {len(zonas)} puntos de monitoreo")
    print(f"Distritos cubiertos: {panel['distrito'].nunique()}")
    print(f"Siniestros descartados (>{RADIO_MAX_ASIGNACION_KM} km de una zona): {descartados_siniestros}")
    print(f"Reportes descartados por lo mismo: {descartados_reportes}")
    print(panel["nivel_riesgo"].value_counts())

    try:
        import mlflow
        if os.environ.get("MLFLOW_TRACKING_URI"):
            mlflow.set_experiment("riesgo-vial")
            with mlflow.start_run(run_name=f"dataset_{fecha_corte.date()}"):
                mlflow.log_param("fecha_corte", str(fecha_corte.date()))
                mlflow.log_param("sha256", sha256)
                mlflow.log_param("radio_max_km", RADIO_MAX_ASIGNACION_KM)
                mlflow.log_metric("filas", len(panel))
                mlflow.log_metric("zonas_cubiertas", panel["zona_id"].nunique())
                mlflow.log_artifact(ruta)
    except Exception as e:
        print(f"Aviso: no se registro en MLflow ({e}). El dataset local se guardo igual.")


if __name__ == "__main__":
    main()