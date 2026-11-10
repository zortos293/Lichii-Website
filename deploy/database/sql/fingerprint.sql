\set ON_ERROR_STOP on
\pset footer off
SET TimeZone = 'UTC';
SET DateStyle = 'ISO, YMD';
SELECT 'games' AS item, count(*) AS rows, md5(coalesce(string_agg(concat_ws('|', sgdb_id, slug, title, md5(catalog::text)), ',' ORDER BY sgdb_id), '')) AS digest FROM games
UNION ALL SELECT 'reports', count(*), md5(coalesce(string_agg(concat_ws('|', id, game_id, md5(fields::text), created_at, triage, md5(internal_note), desktop_submission_key, desktop_submission_hash), ',' ORDER BY id), '')) FROM reports
UNION ALL SELECT 'private_logs', count(*), md5(coalesce(string_agg(concat_ws('|', report_id, md5(content), expires_at), ',' ORDER BY report_id), '')) FROM private_logs
UNION ALL SELECT 'audit_events', count(*), md5(coalesce(string_agg(concat_ws('|', id, actor, action, report_id, created_at), ',' ORDER BY id), '')) FROM audit_events
UNION ALL SELECT 'sessions', count(*), md5(coalesce(string_agg(concat_ws('|', token_hash, github_id, github_login, expires_at), ',' ORDER BY token_hash), '')) FROM sessions
UNION ALL SELECT 'oauth_attempts', count(*), md5(coalesce(string_agg(concat_ws('|', state_hash, expires_at), ',' ORDER BY state_hash), '')) FROM oauth_attempts
UNION ALL SELECT 'schema_migrations', count(*), md5(coalesce(string_agg(concat_ws('|', version, applied_at), ',' ORDER BY version), '')) FROM schema_migrations
UNION ALL SELECT 'audit_events_id_seq', last_value, is_called::text FROM audit_events_id_seq
UNION ALL SELECT 'reports_latest', count(*), max(created_at)::text FROM reports
ORDER BY 1;
