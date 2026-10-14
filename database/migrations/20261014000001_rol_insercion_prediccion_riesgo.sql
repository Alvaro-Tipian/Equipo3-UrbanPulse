-- HT-49 T01, item 3: la API de inferencia (ml/api/main.py) necesita un rol
-- de base de datos que SOLO pueda insertar en prediccion_riesgo. No usa las
-- credenciales DB_USER/DB_HOST/... existentes: esas son de build time (ver
-- ml/api/Dockerfile) y tienen permisos amplios (las usa export_model.py,
-- build_lookup.py y los flujos de n8n contra varias tablas).
--
-- El rol en si NO se crea aqui con password: se crea desde la consola de
-- Neon (Roles -> New role, nombre exacto urbanpulse_api_predicciones) o con
-- ALTER ROLE ... WITH PASSWORD '...' ejecutado directo contra Neon -- nunca
-- en un archivo que se commitea. Esta migracion asume que el rol ya existe
-- (sin permisos) y solo ajusta sus privilegios; si el rol no existe todavia,
-- el bloque de abajo lo crea sin password utilizable (no podra conectarse
-- hasta que alguien le asigne una desde la consola de Neon).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles WHERE rolname = 'urbanpulse_api_predicciones'
  ) THEN
    CREATE ROLE urbanpulse_api_predicciones WITH LOGIN;
  END IF;
END
$$;

-- Idempotente: revoca todo primero para que correr esta migracion dos veces
-- (o despues de agregar tablas nuevas) nunca deje de mas sin querer.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM urbanpulse_api_predicciones;

GRANT USAGE ON SCHEMA public TO urbanpulse_api_predicciones;
GRANT INSERT ON prediccion_riesgo TO urbanpulse_api_predicciones;

-- BIGSERIAL usa una sequence para el id; sin USAGE aqui el INSERT falla con
-- "permission denied for sequence prediccion_riesgo_id_seq" aunque el rol
-- ya tenga INSERT en la tabla.
GRANT USAGE ON SEQUENCE prediccion_riesgo_id_seq TO urbanpulse_api_predicciones;
