-- Migración: crea puntos_monitoreo (catálogo fijo de puntos de Lima) y
-- traffic_readings (histórico de lecturas de congestión de TomTom).
-- Se guarda como histórico porque el dato es muy cambiante: cada consulta
-- a TomTom inserta una fila nueva, nunca se sobreescribe.

CREATE TABLE IF NOT EXISTS puntos_monitoreo (
    nombre      TEXT PRIMARY KEY,
    latitude    DOUBLE PRECISION NOT NULL,
    longitude   DOUBLE PRECISION NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS traffic_readings (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    punto_nombre           TEXT NOT NULL REFERENCES puntos_monitoreo(nombre),
    velocidad_actual       DOUBLE PRECISION,
    velocidad_normal       DOUBLE PRECISION,
    porcentaje_congestion  DOUBLE PRECISION,
    estado                 TEXT,
    captured_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_traffic_readings_punto_fecha
    ON traffic_readings (punto_nombre, captured_at DESC);