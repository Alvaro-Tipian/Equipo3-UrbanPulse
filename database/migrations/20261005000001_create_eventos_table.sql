-- Migration 20261005000001_create_eventos_table.sql
-- Tabla para el Enrutador de Eventos de Dominio (HT-51 T01 / T02)
-- Almacena el sobre común de eventos con garantía de idempotencia (id UUID v4)

CREATE TABLE IF NOT EXISTS eventos (
    id UUID PRIMARY KEY,
    tipo VARCHAR(100) NOT NULL,
    fecha TIMESTAMPTZ NOT NULL,
    origen VARCHAR(255) NOT NULL,
    datos JSONB NOT NULL,
    estado VARCHAR(50) NOT NULL DEFAULT 'recibido', -- 'recibido', 'entregado', 'fallido', 'rechazado'
    intentos INT NOT NULL DEFAULT 0,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eventos_tipo_estado ON eventos (tipo, estado);
CREATE INDEX IF NOT EXISTS idx_eventos_fecha ON eventos (fecha);
