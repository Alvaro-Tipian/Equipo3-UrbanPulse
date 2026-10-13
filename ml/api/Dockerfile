# HT-46 T03 - Imagen de la API de inferencia de riesgo vial.
#
# El modelo (export_model.py) y la tabla de severidad historica por zona
# (build_lookup.py) se descargan/calculan UNA VEZ durante el build, para
# que el contenedor en ejecucion no dependa de MLflow ni de la base de
# datos estando arriba (requisito explicito de la guia).
#
# Los secretos (MLflow y credenciales de la BD) se pasan con
# --mount=type=secret, NUNCA como ARG en texto plano: un ARG queda grabado
# en el historial de capas de la imagen y cualquiera con acceso a la
# imagen podria leerlo con "docker history". Un secret de build solo vive
# en memoria durante el RUN que lo monta y no se escribe en ninguna capa.
#
# Build (ejemplo, desde la raiz del repo, con las variables ya cargadas
# en la sesion de PowerShell desde tu .env -- ver instrucciones aparte):
#   docker build -f ml/api/Dockerfile `
#     --secret id=mlflow_uri,env=MLFLOW_TRACKING_URI `
#     --secret id=mlflow_user,env=MLFLOW_TRACKING_USERNAME `
#     --secret id=mlflow_pass,env=MLFLOW_TRACKING_PASSWORD `
#     --secret id=db_host,env=DB_HOST `
#     --secret id=db_port,env=DB_PORT `
#     --secret id=db_name,env=DB_DATABASE `
#     --secret id=db_user,env=DB_USER `
#     --secret id=db_pass,env=DB_PASSWORD `
#     -t urbanpulse-api:latest .
#
# Run:
#   docker run -p 8000:8000 -e API_KEY=<clave-secreta> urbanpulse-api:latest

FROM python:3.12-slim AS builder

WORKDIR /build

COPY ml/api/requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt

COPY ml/api/export_model.py ml/api/build_lookup.py ./

# Los secretos se montan como archivos en /run/secrets/<id> SOLO durante
# este RUN; no quedan en la imagen final. Se exportan como variables de
# entorno unicamente para este comando (mismos nombres que tu .env, para
# que export_model.py/build_lookup.py los lean sin cambios).
RUN --mount=type=secret,id=mlflow_uri \
    --mount=type=secret,id=mlflow_user \
    --mount=type=secret,id=mlflow_pass \
    --mount=type=secret,id=db_host \
    --mount=type=secret,id=db_port \
    --mount=type=secret,id=db_name \
    --mount=type=secret,id=db_user \
    --mount=type=secret,id=db_pass \
    export MLFLOW_TRACKING_URI="$(cat /run/secrets/mlflow_uri)" && \
    export MLFLOW_TRACKING_USERNAME="$(cat /run/secrets/mlflow_user)" && \
    export MLFLOW_TRACKING_PASSWORD="$(cat /run/secrets/mlflow_pass)" && \
    export DB_HOST="$(cat /run/secrets/db_host)" && \
    export DB_PORT="$(cat /run/secrets/db_port)" && \
    export DB_DATABASE="$(cat /run/secrets/db_name)" && \
    export DB_USER="$(cat /run/secrets/db_user)" && \
    export DB_PASSWORD="$(cat /run/secrets/db_pass)" && \
    python export_model.py && \
    python build_lookup.py

# ---------------------------------------------------------------------------
FROM python:3.12-slim

WORKDIR /app

COPY ml/api/requirements.txt .
RUN pip install --no-cache-dir --break-system-packages -r requirements.txt \
    && rm requirements.txt

COPY ml/api/main.py .
COPY --from=builder /build/model ./model

# API_KEY se pasa en runtime (docker run -e API_KEY=...), nunca horneada
# en la imagen: a diferencia del modelo, es un secreto que puede rotarse
# sin reconstruir la imagen.
ENV PYTHONUNBUFFERED=1

EXPOSE 8000

# Un solo worker: el modelo y la tabla de severidad ya estan en memoria
# (cargados en el startup event); no hay estado que compartir entre
# workers ni beneficio de paralelismo para esta carga esperada.
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
