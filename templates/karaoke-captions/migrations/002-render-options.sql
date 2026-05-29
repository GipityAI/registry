-- Per-render style snapshot. Each export captures the user's Style-tab choices
-- (colors + font scale) so the renders list in the Export tab can show "this
-- one was dark/neon/etc" and the user can pick any past version without
-- re-typing the settings. NULL = renderer defaults (today's behavior),
-- so existing rows stay valid.
--
-- Shape (validated client-side; server passes through to the render job):
--   {
--     "bg_color":     "#0e0e10",   -- background
--     "word_active":  "#ff7a00",   -- currently-sung word
--     "word_past":    "#ffffff",   -- already-sung
--     "word_future":  "#888896",   -- upcoming
--     "font_scale":   1.0          -- 0.7 / 1.0 / 1.3 / 1.6
--   }

ALTER TABLE renders
  ADD COLUMN IF NOT EXISTS render_options JSONB;

COMMENT ON COLUMN renders.render_options IS
  'User-chosen style snapshot for this render. NULL = renderer defaults.';
