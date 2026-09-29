CREATE TABLE IF NOT EXISTS prediccion_riesgo (
    id BIGSERIAL PRIMARY KEY,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    zona_id TEXT NOT NULL,
    franja TEXT NOT NULL,
    fecha_objetivo DATE NOT NULL,
    variables JSONB NOT NULL, -- noqa: RF04
    nivel TEXT NOT NULL,
    probabilidad NUMERIC(4, 3) NOT NULL,
    model_version TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_prediccion_riesgo_fecha_zona_franja
ON prediccion_riesgo (fecha_objetivo, zona_id, franja);
