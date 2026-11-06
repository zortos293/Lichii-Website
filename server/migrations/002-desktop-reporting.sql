ALTER TABLE reports
  ADD COLUMN desktop_submission_key uuid UNIQUE,
  ADD COLUMN desktop_submission_hash text,
  ADD CONSTRAINT desktop_submission_pair CHECK ((desktop_submission_key IS NULL) = (desktop_submission_hash IS NULL)),
  ADD CONSTRAINT desktop_submission_hash_format CHECK (desktop_submission_hash ~ '^[0-9a-f]{64}$');
