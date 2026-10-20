-- Seed: cuadrillas de ejemplo para asignar operativos (HU-09 T01).
-- ON CONFLICT DO NOTHING = seguro de re-ejecutar (idempotente).

INSERT INTO cuadrillas (nombre, especialidad) VALUES
('Bacheo 1', 'bacheo'),
('Señalización 1', 'senalizacion'),
('Semáforos 1', 'semaforos'),
('Limpieza 1', 'limpieza')
ON CONFLICT (nombre) DO NOTHING;
