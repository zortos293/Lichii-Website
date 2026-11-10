\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION public.lichii_write_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The Lichii database is frozen for a migration' USING ERRCODE = 'read_only_sql_transaction';
END $$;
DO $$
DECLARE t regclass;
BEGIN
  FOR t IN SELECT c.oid::regclass FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname <> 'rate_limits'
  LOOP
    EXECUTE format('CREATE TRIGGER lichii_write_freeze BEFORE INSERT OR UPDATE OR DELETE OR TRUNCATE ON %s FOR EACH STATEMENT EXECUTE FUNCTION public.lichii_write_freeze()', t);
  END LOOP;
END $$;
COMMIT;
SELECT count(*) AS frozen_tables FROM pg_trigger WHERE tgname = 'lichii_write_freeze';
