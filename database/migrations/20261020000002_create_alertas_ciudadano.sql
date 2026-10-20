-- HU-10 T01 - Alertas cercanas al ciudadano (contrato C3,
-- docs/ALERTAS_CONTRACT.md; ADR-017 aviso en la app en lugar de SMS)
--
-- Cuando entra un reporte critico, el suscriptor de reporte.creado
-- (HU-10 T02) busca con ST_DWithin a los ciudadanos cuya ultima ubicacion
-- este a menos de 500 m y registra una alerta por cada uno. La app consulta
-- las alertas pendientes del ciudadano del token y las descarta al cerrarlas.
--
-- Solo se guarda la ultima ubicacion que el ciudadano compartio (no un
-- historial) y la consulta descarta las de mas de 24 h. La ubicacion es un
-- dato personal: la app solo la envia si el ciudadano dio el permiso.
CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE usuarios
ADD COLUMN IF NOT EXISTS ultima_ubicacion GEOGRAPHY (POINT, 4326),
ADD COLUMN IF NOT EXISTS ubicacion_actualizada_en TIMESTAMPTZ;

-- Mismo patron que 20260916000001: sin GiST, ST_DWithin recorre toda la
-- tabla de usuarios en cada reporte critico.
CREATE INDEX IF NOT EXISTS idx_usuarios_ultima_ubicacion_gist
ON usuarios USING gist (ultima_ubicacion);

COMMENT ON COLUMN usuarios.ultima_ubicacion IS
'Ultima ubicacion compartida por el ciudadano (POST /urbanpulse/ubicacion). '
'Solo se usa para alertas cercanas; se sobrescribe, no hay historial.';
COMMENT ON COLUMN usuarios.ubicacion_actualizada_en IS
'Fecha de ultima_ubicacion; las de mas de 24 h no reciben alertas.';

CREATE TABLE IF NOT EXISTS alertas_ciudadano (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reporte_id UUID NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
    usuario_id UUID NOT NULL REFERENCES usuarios (id) ON DELETE CASCADE,
    distancia_m INT NOT NULL CHECK (distancia_m >= 0),
    creada_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    descartada_en TIMESTAMPTZ,
    -- El enrutador entrega al menos una vez (ADR-015): si reporte.creado
    -- llega dos veces, ON CONFLICT DO NOTHING evita alertas repetidas.
    CONSTRAINT alertas_ciudadano_reporte_usuario_key
    UNIQUE (reporte_id, usuario_id)
);

-- GET /urbanpulse/alertas: pendientes del ciudadano, mas recientes primero.
CREATE INDEX IF NOT EXISTS idx_alertas_ciudadano_pendientes
ON alertas_ciudadano (usuario_id, creada_en DESC)
WHERE descartada_en IS NULL;
