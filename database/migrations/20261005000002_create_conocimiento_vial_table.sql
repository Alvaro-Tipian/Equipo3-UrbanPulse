-- Migration 20261005000002_create_conocimiento_vial_table.sql
-- Tabla RAG para Fichas de Conocimiento Vial con pgvector (768 dimensiones) (HT-50 T01)

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS conocimiento_vial (
    id BIGSERIAL PRIMARY KEY,
    distrito VARCHAR(100) NOT NULL,
    franja VARCHAR(20) NOT NULL CHECK (franja IN ('mañana', 'tarde', 'noche')),
    contenido TEXT NOT NULL,
    fuente VARCHAR(255) NOT NULL, -- 'SUTRAN', 'ONSV', 'reportes_resueltos'
    embedding vector(768),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conocimiento_vial_distrito_franja ON conocimiento_vial (distrito, franja);
