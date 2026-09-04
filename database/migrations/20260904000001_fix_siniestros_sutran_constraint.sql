-- La migracion 20260831000001 intento agregar uq_siniestro_sutran sobre una
-- tabla inexistente (siniestros_sutran_demo, typo de siniestros_sutran), asi
-- que el ALTER TABLE fallo y el constraint nunca se creo. Sin el, el INSERT
-- ON CONFLICT del flujo de ingesta SUTRAN no tiene con que emparejar y falla
-- con "no unique or exclusion constraint matching the ON CONFLICT specification".
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'uq_siniestro_sutran'
    ) THEN
        ALTER TABLE siniestros_sutran
        ADD CONSTRAINT uq_siniestro_sutran UNIQUE (
            fecha_siniestro, hora_siniestro, departamento, codigo_via, kilometro
        );
    END IF;
END $$;
