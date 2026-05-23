-- 005-app-settings.sql
-- Default application settings

INSERT INTO app_settings (key, value) VALUES
    ('auto_close_days', '7'::jsonb),
    ('ai_auto_categorize_enabled', 'true'::jsonb),
    ('ai_confidence_threshold', '0.7'::jsonb),
    ('ai_auto_assign_enabled', 'true'::jsonb),
    ('ai_auto_assign_confidence', '0.85'::jsonb),
    ('ai_kb_generation_enabled', 'true'::jsonb),
    ('ai_sentiment_enabled', 'true'::jsonb),
    ('default_contact_type', '"self_service"'::jsonb),
    ('incident_number_prefix', '"INC"'::jsonb),
    ('kb_number_prefix', '"KB"'::jsonb),
    ('request_number_prefix', '"REQ"'::jsonb)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
