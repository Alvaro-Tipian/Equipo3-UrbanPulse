-- La migracion 20260916000002 incluia `ALTER ROLE CURRENT_USER CONNECTION
-- LIMIT 20;`. Cambiar el CONNECTION LIMIT de un rol requiere ser
-- superusuario o tener CREATEROLE, y ningun rol de proyecto en Neon lo
-- tiene (tampoco lo expone como ajuste por rol via consola), asi que esa
-- linea fallaba con "permission denied to alter role" (SQLSTATE 42501) y
-- dejaba sin aplicar tambien los dos ALTER ROLE ... SET siguientes. El
-- maximo real de conexiones lo fija el tamano del compute de Neon; para
-- picos de consultas simultaneas la via soportada es su pooler integrado
-- (PgBouncer), usando el endpoint `-pooler` de la connection string en la
-- credencial Postgres que usa n8n en produccion (ver nota en .env.example).
-- Esta migracion vuelve a aplicar solo los timeouts, que si son ajustes que
-- cualquier rol puede hacer sobre si mismo.
ALTER ROLE CURRENT_USER SET statement_timeout = '30s';
ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = '15s';
