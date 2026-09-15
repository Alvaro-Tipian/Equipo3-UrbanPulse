CREATE TABLE IF NOT EXISTS siniestros_sutran (
    id SERIAL PRIMARY KEY,
    fecha_corte TEXT,
    fecha_siniestro TEXT,
    hora_siniestro TEXT,
    departamento TEXT,
    codigo_via TEXT,
    kilometro TEXT,
    modalidad TEXT,
    fallecidos INT,
    heridos INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE siniestros_sutran
ADD CONSTRAINT uq_siniestro_sutran UNIQUE (
    fecha_siniestro, hora_siniestro, departamento, codigo_via, kilometro
);
