-- Las consultas de proximidad del mapa (ST_DWithin contra siniestros_fatales,
-- usada por el nodo "Riesgo histórico" de UrbanPulse-Flujo-vr3) y las futuras
-- de siniestros_sutran necesitan un índice GiST sobre la columna geométrica;
-- sin él, Postgres hace un seq scan completo de la tabla en cada búsqueda.
CREATE EXTENSION IF NOT EXISTS postgis;

-- siniestros_fatales ya inserta geom en cada fila nueva (ver INSERT en
-- UrbanPulse-Flujo-vr2/vr3) y ya tiene el índice idx_siniestros_geom desde la
-- migración 20260817000002. Este UPDATE solo rellena geom en filas antiguas
-- que se hayan cargado antes de que esa columna existiera.
UPDATE siniestros_fatales
SET geom = ST_SETSRID(ST_MAKEPOINT(longitud, latitud), 4326)
WHERE
    geom IS NULL
    AND latitud IS NOT NULL
    AND longitud IS NOT NULL
    AND latitud != 0
    AND longitud != 0;

-- siniestros_sutran todavía no tiene columna geométrica: se agrega como
-- GEOGRAPHY para georreferenciar estos siniestros más adelante y dejar el
-- índice GiST listo desde ya.
ALTER TABLE siniestros_sutran
ADD COLUMN IF NOT EXISTS geom GEOGRAPHY (POINT, 4326);

CREATE INDEX IF NOT EXISTS idx_siniestros_sutran_geom_gist
ON siniestros_sutran USING gist (
    geom
);
