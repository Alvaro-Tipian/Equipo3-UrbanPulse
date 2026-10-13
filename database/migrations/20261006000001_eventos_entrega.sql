-- Migration 20261006000001_eventos_entrega.sql
-- Enrutador de Eventos (HT-51 T02): trazabilidad de la entrega y reproceso.
-- Idempotente: se puede ejecutar varias veces sin error.

ALTER TABLE eventos ADD COLUMN IF NOT EXISTS entregado_en TIMESTAMPTZ;
ALTER TABLE eventos ADD COLUMN IF NOT EXISTS ultimo_error TEXT;

-- Acelera la consulta del workflow de reproceso.
CREATE INDEX IF NOT EXISTS idx_eventos_reproceso
ON eventos (estado, intentos, actualizado_en);
