-- Seed: puntos fijos de Lima a monitorear con TomTom.
-- ON CONFLICT DO NOTHING = seguro de re-ejecutar (idempotente).

INSERT INTO puntos_monitoreo (nombre, latitude, longitude) VALUES
('Javier Prado / Arequipa',        -12.0891, -77.0328),
('Panamericana Sur - Surco',       -12.1211, -76.9989),
('Vía Expresa - San Isidro',       -12.1000, -77.0350),
('Túnel Santa Rosa',               -12.0553, -77.0465),
('Av. Universitaria - Los Olivos', -11.9989, -77.0755)
ON CONFLICT (nombre) DO NOTHING;