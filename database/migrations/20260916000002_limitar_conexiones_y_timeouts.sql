-- Todos los workflows de n8n (chat, reportes, KPIs del dashboard, mapa) y los
-- scripts de verificación comparten un mismo rol de conexión a Neon. Una
-- ráfaga de consultas simultáneas podía abrir conexiones sin límite y agotar
-- el cupo del compute de Neon, tumbando el resto de peticiones. CURRENT_USER
-- referencia al rol que ejecuta esta migración (urban_admin en local, el rol
-- de la app en Neon), así que no hace falta hardcodear su nombre aquí.
ALTER ROLE CURRENT_USER CONNECTION LIMIT 20;

-- Una consulta lenta o una transacción que un workflow deja abierta por error
-- retenía su conexión indefinidamente, reduciendo aún más el cupo disponible
-- para el resto. Estos timeouts liberan la conexión automáticamente.
ALTER ROLE CURRENT_USER SET statement_timeout = '30s';
ALTER ROLE CURRENT_USER SET idle_in_transaction_session_timeout = '15s';
