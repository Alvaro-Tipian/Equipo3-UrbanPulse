-- HU-04 Dashboard del Operador: agrega el estado intermedio "en_proceso"
-- entre pendiente y resuelto, y lo deja acotado con un CHECK (antes
-- `status` era TEXT libre sin restricción).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_status_check'
  ) THEN
    ALTER TABLE reports
    ADD CONSTRAINT reports_status_check
    CHECK (status IN ('pending', 'en_proceso', 'resuelto'));
  END IF;
END $$;
