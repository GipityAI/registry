-- 006-reporting.sql
-- KPI scores and notifications

CREATE TABLE IF NOT EXISTS kpi_scores (
    id SERIAL PRIMARY KEY,
    kpi_name VARCHAR(100) NOT NULL,
    value DECIMAL(10,2) NOT NULL,
    dimension VARCHAR(100),
    period_date DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_kpi_scores_lookup ON kpi_scores(kpi_name, period_date, dimension);

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    title VARCHAR(300) NOT NULL,
    body TEXT,
    link VARCHAR(500),
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);
