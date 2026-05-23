-- 004-default-teams.sql
-- Default support teams

INSERT INTO teams (name, slug, email) VALUES
    ('Service Desk', 'service-desk', 'servicedesk@company.com'),
    ('Network Operations', 'network-ops', 'netops@company.com'),
    ('Desktop Support', 'desktop-support', 'desktop@company.com'),
    ('Application Support', 'app-support', 'appsupport@company.com'),
    ('Security', 'security', 'security@company.com'),
    ('Infrastructure', 'infrastructure', 'infra@company.com')
ON CONFLICT (slug) DO NOTHING;
