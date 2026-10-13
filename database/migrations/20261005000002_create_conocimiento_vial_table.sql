-- HT-50 T01: base de conocimiento del RAG de consultas viales.
--
-- Una ficha por distrito de Lima Metropolitana (43) y franja horaria, armada
-- con datos reales de ONSV (siniestros_fatales) y de los reportes ciudadanos
-- resueltos, mas tres fichas de la red vial nacional en Lima con SUTRAN (que
-- no esta geocodificado y no se puede asignar a un distrito, ver ml/README.md).
-- El workflow ia-ops/workflows/n8n_ingesta_rag.json redacta cada ficha, la
-- vectoriza con gemini-embedding-001 (768 dimensiones, el mismo modelo que
-- usa el flujo del chat) y la guarda aqui.
--
-- franja usa manana/tarde/noche sin ene, igual que el dataset de HT-46.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS postgis;

-- La primera version de esta tabla (68b69771) guardaba vectores aleatorios
-- sin clave unica. Si llego a crearse, no tiene nada que conservar.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'conocimiento_vial'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conocimiento_vial' AND column_name = 'clave'
    ) THEN
        DROP TABLE conocimiento_vial;
    END IF;
END $$;

-- Catalogo de los 43 distritos de la provincia de Lima. nombre_normalizado
-- es la clave de cruce con ONSV (mayusculas, sin tildes ni enes) y
-- variantes guarda otras formas en que aparece el nombre.
CREATE TABLE IF NOT EXISTS distritos_lima (
    nombre_normalizado TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    variantes TEXT[] NOT NULL DEFAULT '{}'
);

CREATE OR REPLACE FUNCTION normalizar_distrito(valor TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT NULLIF(
        REGEXP_REPLACE(
            UPPER(TRANSLATE(
                TRIM(valor),
                'áéíóúüñÁÉÍÓÚÜÑ',
                'aeiouunAEIOUUN'
            )),
            '\s+', ' ', 'g'
        ),
        ''
    );
$$;

INSERT INTO distritos_lima (nombre_normalizado, nombre, variantes) VALUES
('ANCON', 'Ancón', '{}'),
('ATE', 'Ate', '{"ATE VITARTE"}'),
('BARRANCO', 'Barranco', '{}'),
('BRENA', 'Breña', '{}'),
('CARABAYLLO', 'Carabayllo', '{}'),
('CHACLACAYO', 'Chaclacayo', '{}'),
('CHORRILLOS', 'Chorrillos', '{}'),
('CIENEGUILLA', 'Cieneguilla', '{}'),
('COMAS', 'Comas', '{}'),
('EL AGUSTINO', 'El Agustino', '{}'),
('INDEPENDENCIA', 'Independencia', '{}'),
('JESUS MARIA', 'Jesús María', '{}'),
('LA MOLINA', 'La Molina', '{}'),
('LA VICTORIA', 'La Victoria', '{}'),
('LIMA', 'Lima (Cercado)', '{"CERCADO DE LIMA", "CERCADO"}'),
('LINCE', 'Lince', '{}'),
('LOS OLIVOS', 'Los Olivos', '{}'),
('LURIGANCHO', 'Lurigancho (Chosica)', '{"CHOSICA", "LURIGANCHO CHOSICA"}'),
('LURIN', 'Lurín', '{}'),
('MAGDALENA DEL MAR', 'Magdalena del Mar', '{"MAGDALENA"}'),
('MIRAFLORES', 'Miraflores', '{}'),
('PACHACAMAC', 'Pachacámac', '{}'),
('PUCUSANA', 'Pucusana', '{}'),
('PUEBLO LIBRE', 'Pueblo Libre', '{"MAGDALENA VIEJA"}'),
('PUENTE PIEDRA', 'Puente Piedra', '{}'),
('PUNTA HERMOSA', 'Punta Hermosa', '{}'),
('PUNTA NEGRA', 'Punta Negra', '{}'),
('RIMAC', 'Rímac', '{}'),
('SAN BARTOLO', 'San Bartolo', '{}'),
('SAN BORJA', 'San Borja', '{}'),
('SAN ISIDRO', 'San Isidro', '{}'),
('SAN JUAN DE LURIGANCHO', 'San Juan de Lurigancho', '{"SJL"}'),
('SAN JUAN DE MIRAFLORES', 'San Juan de Miraflores', '{"SJM"}'),
('SAN LUIS', 'San Luis', '{}'),
('SAN MARTIN DE PORRES', 'San Martín de Porres', '{"SMP"}'),
('SAN MIGUEL', 'San Miguel', '{}'),
('SANTA ANITA', 'Santa Anita', '{}'),
('SANTA MARIA DEL MAR', 'Santa María del Mar', '{}'),
('SANTA ROSA', 'Santa Rosa', '{}'),
('SANTIAGO DE SURCO', 'Santiago de Surco', '{"SURCO"}'),
('SURQUILLO', 'Surquillo', '{}'),
('VILLA EL SALVADOR', 'Villa El Salvador', '{}'),
('VILLA MARIA DEL TRIUNFO', 'Villa María del Triunfo', '{}')
ON CONFLICT (nombre_normalizado) DO UPDATE
    SET nombre = excluded.nombre, variantes = excluded.variantes;

CREATE TABLE IF NOT EXISTS conocimiento_vial (
    id BIGSERIAL PRIMARY KEY,
    -- distrito:<NOMBRE_NORMALIZADO>:<franja> o red_vial_nacional:<franja>
    clave TEXT NOT NULL UNIQUE,
    ambito TEXT NOT NULL CHECK (ambito IN ('distrito', 'red_vial_nacional')),
    distrito TEXT REFERENCES distritos_lima (nombre_normalizado),
    franja TEXT NOT NULL CHECK (franja IN ('manana', 'tarde', 'noche')),
    contenido TEXT NOT NULL,
    fuentes TEXT[] NOT NULL,
    metricas JSONB NOT NULL,
    -- SHA-256 de contenido: si no cambia, no se vuelve a pedir el embedding.
    contenido_sha256 TEXT NOT NULL,
    embedding VECTOR(768) NOT NULL,
    modelo_embedding TEXT NOT NULL,
    creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_conocimiento_vial_distrito CHECK (
        (ambito = 'distrito') = (distrito IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_conocimiento_vial_distrito_franja
ON conocimiento_vial (distrito, franja);

-- Busqueda por similitud del coseno (top 5 de HT-50 T02).
CREATE INDEX IF NOT EXISTS idx_conocimiento_vial_embedding
ON conocimiento_vial USING hnsw (embedding vector_cosine_ops);

-- Metricas de cada ficha. p_distrito filtra un distrito (NULL = todos, en ese
-- caso tambien devuelve las fichas de SUTRAN). Las ventanas se cuentan desde
-- el dato mas reciente de cada fuente, no desde hoy, porque ONSV y SUTRAN
-- publican con meses de rezago.
CREATE OR REPLACE FUNCTION fichas_conocimiento_vial(
    p_distrito TEXT DEFAULT NULL
)
RETURNS TABLE (
    clave TEXT,
    ambito TEXT,
    distrito TEXT,
    distrito_nombre TEXT,
    franja TEXT,
    fuentes TEXT[],
    metricas JSONB
)
LANGUAGE sql
STABLE
AS $$
WITH
franjas (franja) AS (
    VALUES ('manana'), ('tarde'), ('noche')
),
alcance AS (
    SELECT d.nombre_normalizado, d.nombre
    FROM distritos_lima AS d
    WHERE
        p_distrito IS NULL
        OR d.nombre_normalizado = normalizar_distrito(p_distrito)
        OR normalizar_distrito(p_distrito) = ANY(d.variantes)
),
onsv AS (
    SELECT
        s.*,
        COALESCE(
            dl.nombre_normalizado, da.nombre_normalizado
        ) AS distrito_norm,
        CASE
            WHEN SPLIT_PART(s.hora_siniestro, ':', 1) !~ '^\d{1,2}$'
                THEN NULL
            WHEN SPLIT_PART(s.hora_siniestro, ':', 1)::INT BETWEEN 6 AND 11
                THEN 'manana'
            WHEN SPLIT_PART(s.hora_siniestro, ':', 1)::INT BETWEEN 12 AND 17
                THEN 'tarde'
            ELSE 'noche'
        END AS franja
    FROM siniestros_fatales AS s
    LEFT JOIN distritos_lima AS dl
        ON normalizar_distrito(s.distrito) = dl.nombre_normalizado
    LEFT JOIN distritos_lima AS da
        ON normalizar_distrito(s.distrito) = ANY(da.variantes)
    WHERE
        normalizar_distrito(s.departamento) = 'LIMA'
        AND normalizar_distrito(s.provincia) = 'LIMA'
        AND s.fecha_iso IS NOT NULL
),
onsv_ventana AS (
    SELECT o.*
    FROM onsv AS o
    WHERE o.fecha_iso > (SELECT MAX(fecha_iso) FROM onsv) - INTERVAL '12 months'
),
onsv_agg AS (
    SELECT
        o.distrito_norm,
        o.franja,
        COUNT(*) AS siniestros,
        COALESCE(SUM(o.fallecidos), 0) AS fallecidos,
        COALESCE(SUM(o.lesionados), 0) AS lesionados,
        MODE() WITHIN GROUP (ORDER BY o.clase_siniestro) AS clase_frecuente,
        MODE() WITHIN GROUP (ORDER BY o.causa_factor_principal)
            AS causa_frecuente,
        MODE() WITHIN GROUP (ORDER BY o.tipo_via) AS via_frecuente
    FROM onsv_ventana AS o
    WHERE o.distrito_norm IS NOT NULL AND o.franja IS NOT NULL
    GROUP BY o.distrito_norm, o.franja
),
-- Inicio y fin de la ventana de 12 meses (no del primer y ultimo dato).
onsv_periodo AS (
    SELECT
        (MAX(fecha_iso) - INTERVAL '12 months' + INTERVAL '1 day')::DATE
            AS desde,
        MAX(fecha_iso) AS hasta
    FROM onsv
),
-- Los reportes no guardan distrito: se asignan al distrito del siniestro
-- ONSV mas cercano dentro de 3 km (mismo radio que build_dataset.py).
reportes AS (
    SELECT
        r.id,
        r.incident_type,
        cercano.distrito_norm,
        CASE
            WHEN EXTRACT(HOUR FROM r.created_at AT TIME ZONE 'America/Lima')
                BETWEEN 6 AND 11 THEN 'manana'
            WHEN EXTRACT(HOUR FROM r.created_at AT TIME ZONE 'America/Lima')
                BETWEEN 12 AND 17 THEN 'tarde'
            ELSE 'noche'
        END AS franja
    FROM reports AS r
    CROSS JOIN LATERAL (
        SELECT o.distrito_norm
        FROM onsv AS o
        WHERE
            o.geom IS NOT NULL
            AND o.distrito_norm IS NOT NULL
            AND ST_DWITHIN(
                o.geom::GEOGRAPHY,
                ST_SETSRID(
                    ST_MAKEPOINT(r.longitude, r.latitude), 4326
                )::GEOGRAPHY,
                3000
            )
        ORDER BY
            o.geom <-> ST_SETSRID(ST_MAKEPOINT(r.longitude, r.latitude), 4326)
        LIMIT 1
    ) AS cercano
    WHERE
        r.status = 'resuelto'
        AND r.latitude IS NOT NULL
        AND r.longitude IS NOT NULL
        AND COALESCE(r.resolved_at, r.created_at)
        > NOW() - INTERVAL '90 days'
),
reportes_agg AS (
    SELECT
        distrito_norm,
        franja,
        COUNT(*) AS reportes_resueltos,
        MODE() WITHIN GROUP (ORDER BY incident_type) AS tipo_frecuente
    FROM reportes
    GROUP BY distrito_norm, franja
),
sutran AS (
    SELECT
        s.codigo_via,
        s.kilometro,
        s.fallecidos,
        s.heridos,
        CASE
            WHEN s.fecha_siniestro ~ '^\d{4}-\d{2}-\d{2}'
                THEN TO_DATE(LEFT(s.fecha_siniestro, 10), 'YYYY-MM-DD')
            WHEN s.fecha_siniestro ~ '^\d{2}/\d{2}/\d{4}'
                THEN TO_DATE(LEFT(s.fecha_siniestro, 10), 'DD/MM/YYYY')
        END AS fecha,
        CASE
            WHEN SPLIT_PART(s.hora_siniestro, ':', 1) !~ '^\d{1,2}$'
                THEN NULL
            WHEN SPLIT_PART(s.hora_siniestro, ':', 1)::INT BETWEEN 6 AND 11
                THEN 'manana'
            WHEN SPLIT_PART(s.hora_siniestro, ':', 1)::INT BETWEEN 12 AND 17
                THEN 'tarde'
            ELSE 'noche'
        END AS franja
    FROM siniestros_sutran AS s
    WHERE normalizar_distrito(s.departamento) = 'LIMA'
),
sutran_ventana AS (
    SELECT s.*
    FROM sutran AS s
    WHERE
        s.franja IS NOT NULL
        AND s.fecha > (SELECT MAX(fecha) FROM sutran) - INTERVAL '12 months'
),
sutran_vias AS (
    SELECT
        franja,
        codigo_via,
        COUNT(*) AS siniestros,
        COALESCE(SUM(fallecidos), 0) AS fallecidos,
        COALESCE(SUM(heridos), 0) AS heridos,
        MODE() WITHIN GROUP (ORDER BY kilometro) AS km_frecuente,
        ROW_NUMBER() OVER (
            PARTITION BY franja ORDER BY COUNT(*) DESC, codigo_via
        ) AS orden
    FROM sutran_ventana
    GROUP BY franja, codigo_via
)
SELECT
    'distrito:' || a.nombre_normalizado || ':' || f.franja AS clave,
    'distrito' AS ambito,
    a.nombre_normalizado AS distrito,
    a.nombre AS distrito_nombre,
    f.franja,
    -- Fuentes consultadas: un conteo en cero tambien es un dato de ONSV.
    ARRAY['ONSV', 'reportes_resueltos'] AS fuentes,
    JSONB_BUILD_OBJECT(
        'onsv_desde', op.desde,
        'onsv_hasta', op.hasta,
        'siniestros', COALESCE(oa.siniestros, 0),
        'fallecidos', COALESCE(oa.fallecidos, 0),
        'lesionados', COALESCE(oa.lesionados, 0),
        'clase_frecuente', oa.clase_frecuente,
        'causa_frecuente', oa.causa_frecuente,
        'via_frecuente', oa.via_frecuente,
        'reportes_resueltos_90d', COALESCE(ra.reportes_resueltos, 0),
        'tipo_reporte_frecuente', ra.tipo_frecuente
    ) AS metricas
FROM alcance AS a
CROSS JOIN franjas AS f
CROSS JOIN onsv_periodo AS op
LEFT JOIN onsv_agg AS oa
    ON a.nombre_normalizado = oa.distrito_norm AND f.franja = oa.franja
LEFT JOIN reportes_agg AS ra
    ON a.nombre_normalizado = ra.distrito_norm AND f.franja = ra.franja
UNION ALL
SELECT
    'red_vial_nacional:' || f.franja AS clave,
    'red_vial_nacional' AS ambito,
    NULL AS distrito,
    'Red vial nacional en Lima' AS distrito_nombre,
    f.franja,
    ARRAY['SUTRAN'] AS fuentes,
    JSONB_BUILD_OBJECT(
        'sutran_desde', (
            SELECT (MAX(fecha) - INTERVAL '12 months' + INTERVAL '1 day')::DATE
            FROM sutran
        ),
        'sutran_hasta', (SELECT MAX(fecha) FROM sutran),
        'vias', COALESCE(
            JSONB_AGG(
                JSONB_BUILD_OBJECT(
                    'codigo_via', sv.codigo_via,
                    'siniestros', sv.siniestros,
                    'fallecidos', sv.fallecidos,
                    'heridos', sv.heridos,
                    'km_frecuente', sv.km_frecuente
                ) ORDER BY sv.orden
            ) FILTER (WHERE sv.codigo_via IS NOT NULL),
            '[]'::JSONB
        )
    ) AS metricas
FROM franjas AS f
LEFT JOIN sutran_vias AS sv ON f.franja = sv.franja AND sv.orden <= 5
WHERE p_distrito IS NULL
GROUP BY f.franja;
$$;

-- Distrito de un reporte ciudadano: el del siniestro ONSV de Lima mas cercano
-- dentro de 3 km (NULL si no hay ninguno). Lo usa la ingesta cuando el evento
-- reporte.creado no trae el distrito.
CREATE OR REPLACE FUNCTION distrito_de_reporte(p_reporte_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
AS $$
    SELECT COALESCE(dl.nombre_normalizado, dv.nombre_normalizado)
    FROM reports AS r
    CROSS JOIN LATERAL (
        SELECT s.distrito
        FROM siniestros_fatales AS s
        WHERE
            s.geom IS NOT NULL
            AND normalizar_distrito(s.provincia) = 'LIMA'
            AND ST_DWITHIN(
                s.geom::GEOGRAPHY,
                ST_SETSRID(
                    ST_MAKEPOINT(r.longitude, r.latitude), 4326
                )::GEOGRAPHY,
                3000
            )
        ORDER BY
            s.geom <-> ST_SETSRID(ST_MAKEPOINT(r.longitude, r.latitude), 4326)
        LIMIT 1
    ) AS cercano
    LEFT JOIN distritos_lima AS dl
        ON normalizar_distrito(cercano.distrito) = dl.nombre_normalizado
    LEFT JOIN distritos_lima AS dv
        ON normalizar_distrito(cercano.distrito) = ANY(dv.variantes)
    WHERE r.id = p_reporte_id;
$$;
