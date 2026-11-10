\set ON_ERROR_STOP on
BEGIN;
DO $$
DECLARE t regclass;
BEGIN
  FOR t IN SELECT tgrelid::regclass FROM pg_trigger WHERE tgname = 'lichii_write_freeze' LOOP
    EXECUTE format('DROP TRIGGER lichii_write_freeze ON %s', t);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.lichii_write_freeze();
COMMIT;
