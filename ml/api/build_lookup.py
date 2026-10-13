"""
HT-46 T03 - Genera la tabla severidad_por_zona a partir de Neon, para
que la API pueda enriquecer cada peticion de /predict con la severidad
historica de la zona (severidad_media), que el modelo necesita pero el
contrato 4.1 NO envia en la peticion (es un dato historico, no algo que
se pueda calcular "en vivo" en el momento del request).

Reutiliza la misma logica de severidad que ml/data/build_dataset.py:
  severidad = fallecidos + lesionados (por siniestro de siniestros_fatales)
  severidad_media = promedio de "severidad" por zona x franja, en los
  ultimos 365 dias desde la fecha de construccion de la imagen.

Simplificacion respecto al entrenamiento: el modelo se entreno con la
clave (zona_id, franja, dia_semana); aqui se usa (zona_id, franja) sin
dia_semana, porque el contrato 4.1 no pide dia_semana explicito en cada
zona (solo una "fecha" a nivel de todo el batch) y la API no debe tener
que inferirlo. Es una aproximacion razonable: la severidad historica de
una zona varia mucho menos por dia de la semana que por franja horaria.
Si una zona no aparece en esta tabla (sin siniestros en los ultimos 365
dias), /predict usa 0.0 -- mismo criterio de fillna(0.0) que usa el
pipeline de entrenamiento.

Se ejecuta UNA SOLA VEZ, durante el build de la imagen (ver Dockerfile),
igual que export_model.py. No se ejecuta en cada peticion.

Uso:
  python ml/api/build_lookup.py
"""
import json
import os
from urllib.parse import quote_plus

import pandas as pd
from dotenv import load_dotenv
from sqlalchemy import create_engine

load_dotenv()

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "model")
VENTANA_TRAILING_DIAS = 365


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


def main():
    engine = get_engine()

    zonas = pd.read_sql(
        "SELECT nombre AS zona_id, latitude, longitude FROM puntos_monitoreo", engine
    )
    siniestros = pd.read_sql(
        """
        SELECT fecha_iso AS fecha, hora_siniestro, fallecidos, lesionados,
               latitud, longitud
        FROM siniestros_fatales
        """,
        engine,
    )
    siniestros["fecha"] = pd.to_datetime(siniestros["fecha"])
    siniestros["severidad"] = siniestros["fallecidos"].fillna(0) + siniestros["lesionados"].fillna(0)
    siniestros["franja"] = siniestros["hora_siniestro"].apply(derive_franja)

    fecha_corte = pd.Timestamp.now(tz=None).normalize()
    ini_trailing = fecha_corte - pd.Timedelta(days=VENTANA_TRAILING_DIAS)
    siniestros = siniestros[(siniestros["fecha"] >= ini_trailing) & (siniestros["fecha"] < fecha_corte)]
    siniestros = siniestros.dropna(subset=["latitud", "longitud", "franja"])

    if siniestros.empty or zonas.empty:
        print("Sin siniestros o sin zonas en la ventana; severidad_por_zona.json queda vacio.")
        lookup = {}
    else:
        from sklearn.neighbors import BallTree
        import numpy as np

        RADIO_TIERRA_KM = 6371.0
        RADIO_MAX_ASIGNACION_KM = 3.0

        arbol = BallTree(np.radians(zonas[["latitude", "longitude"]].values), metric="haversine")
        dist, idx = arbol.query(np.radians(siniestros[["latitud", "longitud"]].values), k=1)
        siniestros = siniestros.assign(
            zona_id=zonas["zona_id"].values[idx[:, 0]],
            dist_km=dist[:, 0] * RADIO_TIERRA_KM,
        )
        siniestros = siniestros[siniestros["dist_km"] <= RADIO_MAX_ASIGNACION_KM]

        agg = (
            siniestros.groupby(["zona_id", "franja"])["severidad"]
            .mean()
            .reset_index()
        )
        lookup = {}
        for _, row in agg.iterrows():
            lookup.setdefault(row["zona_id"], {})[row["franja"]] = round(float(row["severidad"]), 3)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    ruta = os.path.join(OUTPUT_DIR, "severidad_por_zona.json")
    with open(ruta, "w") as f:
        json.dump(lookup, f, indent=2, ensure_ascii=False)

    print(f"severidad_por_zona.json generado con {len(lookup)} zonas -> {ruta}")


if __name__ == "__main__":
    main()
