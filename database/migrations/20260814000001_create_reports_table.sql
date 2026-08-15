-- Migración: activa pgvector y crea la tabla `reports` para el flujo PoC
-- Frontend -> n8n -> PostgreSQL+pgvector -> LLM
--
-- Dimensión del embedding: 384.
-- Justificación: 384 es la dimensión de salida del modelo
-- "sentence-transformers/all-MiniLM-L6-v2", un modelo de embeddings local
-- y gratuito (no requiere API key ni servicio de pago), consistente con la
-- restricción del proyecto de no usar librerías/servicios que rompan el
-- free tier. Si en el futuro se cambia a un modelo de embeddings distinto
-- (por ejemplo uno de Gemini/OpenAI con otra dimensión), esta columna y su
-- valor deben migrarse juntos.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS reports (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    description   TEXT NOT NULL,
    image_url     TEXT,
    incident_type TEXT,
    severity      TEXT,
    latitude      DOUBLE PRECISION,
    longitude     DOUBLE PRECISION,
    priority      INT,
    status        TEXT NOT NULL DEFAULT 'pending',
    embedding     VECTOR(384),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
