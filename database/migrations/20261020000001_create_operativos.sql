-- HU-09 T01 - Operativos y cuadrillas (contrato C2,
-- docs/OPERATIVOS_CONTRACT.md)
--
-- Un operativo agrupa reportes abiertos de una misma zona para que una
-- cuadrilla los atienda juntos. Las fechas de creacion, asignacion y cierre
-- quedan en la fila para que HU-11 mida la efectividad y el tiempo de
-- atencion sin depender de un historial aparte.
--
-- Zona = distrito del reporte, con el mismo criterio del ranking del panel
-- de riesgo y de la ingesta RAG: distrito_de_reporte(reporte_id) devuelve
-- distritos_lima.nombre_normalizado (ej. 'MIRAFLORES'). No se usa FK a
-- distritos_lima porque los reportes sin distrito se agrupan en
-- 'SIN_DISTRITO' y tambien pueden formar un operativo.

CREATE TABLE IF NOT EXISTS cuadrillas (
    id SERIAL PRIMARY KEY,
    nombre TEXT NOT NULL UNIQUE,
    especialidad TEXT NOT NULL CHECK (
        especialidad IN ('bacheo', 'senalizacion', 'semaforos', 'limpieza')
    ),
    activa BOOLEAN NOT NULL DEFAULT TRUE,
    creada_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS operativos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    zona TEXT NOT NULL,
    estado TEXT NOT NULL DEFAULT 'planificado' CHECK (
        estado IN ('planificado', 'asignado', 'en_curso', 'cerrado')
    ),
    cuadrilla_id INT REFERENCES cuadrillas (id),
    creado_por UUID REFERENCES usuarios (id),
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    asignado_en TIMESTAMPTZ,
    cerrado_en TIMESTAMPTZ,
    -- Un operativo que ya salio de "planificado" debe tener cuadrilla y
    -- fecha de asignacion; uno cerrado, ademas, su fecha de cierre.
    CONSTRAINT operativos_asignacion_check CHECK (
        estado = 'planificado'
        OR (cuadrilla_id IS NOT NULL AND asignado_en IS NOT NULL)
    ),
    CONSTRAINT operativos_cierre_check CHECK (
        (estado = 'cerrado') = (cerrado_en IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_operativos_estado ON operativos (estado);
CREATE INDEX IF NOT EXISTS idx_operativos_zona ON operativos (zona);
CREATE INDEX IF NOT EXISTS idx_operativos_cerrado_en
ON operativos (cerrado_en) WHERE cerrado_en IS NOT NULL;

CREATE TABLE IF NOT EXISTS operativo_reportes (
    operativo_id UUID NOT NULL REFERENCES operativos (id) ON DELETE CASCADE,
    reporte_id UUID NOT NULL REFERENCES reports (id),
    agregado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (operativo_id, reporte_id)
);

-- Para saber en que operativo esta un reporte (la bandeja oculta los que ya
-- estan en un operativo abierto).
CREATE INDEX IF NOT EXISTS idx_operativo_reportes_reporte
ON operativo_reportes (reporte_id);

COMMENT ON COLUMN operativos.zona IS
'distritos_lima.nombre_normalizado del distrito de sus reportes '
'(distrito_de_reporte), o SIN_DISTRITO.';
COMMENT ON COLUMN operativos.asignado_en IS
'Primera vez que se asigno cuadrilla; inicio del tiempo de atencion.';
COMMENT ON COLUMN operativos.cerrado_en IS
'Cierre del operativo; sus reportes pasan a resuelto en la misma operacion.';
