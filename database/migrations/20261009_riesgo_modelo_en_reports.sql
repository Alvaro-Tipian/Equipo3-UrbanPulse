-- HT-46 T03 - Guarda en cada reporte que version del modelo (o si fue el
-- calculo heuristico) produjo su riesgo. Sin estas columnas no habria
-- forma de distinguir, ya guardado el reporte, si el riesgo vino de la
-- API (/predict) o del respaldo heuristico que corre en n8n cuando la
-- llamada a la API falla o excede el timeout de 3s.
--
-- riesgo_origen usa un CHECK en vez de una tabla aparte porque solo tiene
-- dos valores posibles y no va a crecer; un ENUM de Postgres habria sido
-- igual de valido pero mas costoso de alterar despues si se necesita un
-- tercer valor.

ALTER TABLE reports
ADD COLUMN IF NOT EXISTS riesgo_modelo_version TEXT,
ADD COLUMN IF NOT EXISTS riesgo_origen TEXT;

ALTER TABLE reports
ADD CONSTRAINT reports_riesgo_origen_check
CHECK (riesgo_origen IS NULL OR riesgo_origen IN ('modelo', 'heuristico'));

COMMENT ON COLUMN reports.riesgo_modelo_version IS
'Version del modelo que calculo el riesgo (ej. "riesgo_vial@3"), o NULL '
'si riesgo_origen = heuristico.';
COMMENT ON COLUMN reports.riesgo_origen IS
'"modelo" si /predict respondio a tiempo; "heuristico" si n8n usó el '
'calculo de respaldo (timeout o error de la API).';
