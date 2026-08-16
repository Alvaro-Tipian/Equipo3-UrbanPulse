-- Migración: crea traffic_incidents para accidentes/incidentes viales
-- obtenidos de TomTom Traffic Incidents API (bounding box de Lima).

CREATE TABLE IF NOT EXISTS traffic_incidents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    icon_category   INT,
    descripcion     TEXT,
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    start_time      TIMESTAMPTZ,
    end_time        TIMESTAMPTZ,
    raw_properties  JSONB,
    captured_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);