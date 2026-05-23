-- 006-catalog.sql
-- Service catalog categories and items

INSERT INTO catalog_categories (name, icon, sort_order, is_active) VALUES
    ('Hardware', 'laptop', 1, true),
    ('Software', 'code', 2, true),
    ('Access', 'key', 3, true),
    ('Communication', 'mail', 4, true),
    ('General', 'help-circle', 5, true)
ON CONFLICT DO NOTHING;

-- Hardware items
INSERT INTO catalog_items (name, description, category_id, price, delivery_days, approval_required, fulfillment_team_id, form_schema, is_active)
SELECT item.name, item.description,
    (SELECT id FROM catalog_categories WHERE name = item.category),
    item.price, item.delivery_days, item.approval_required,
    (SELECT id FROM teams WHERE slug = item.team_slug),
    item.form_schema::jsonb, true
FROM (VALUES
    ('New Laptop', 'Request a new laptop for a team member.', 'Hardware', 1200.00, 5, true, 'desktop-support',
     '{"fields": [{"name": "model", "type": "select", "label": "Laptop Model", "required": true, "options": ["MacBook Pro 14\"", "MacBook Pro 16\"", "ThinkPad X1 Carbon", "Dell XPS 15", "HP EliteBook 840"]}, {"name": "reason", "type": "textarea", "label": "Business Justification", "required": true}]}'),
    ('Additional Monitor', 'Request an additional external monitor.', 'Hardware', 350.00, 3, false, 'desktop-support',
     '{"fields": [{"name": "size", "type": "select", "label": "Monitor Size", "required": true, "options": ["24\" 1080p", "27\" 1440p", "27\" 4K", "32\" 4K"]}, {"name": "mount", "type": "select", "label": "Mount Type", "options": ["Stand", "Monitor Arm"]}]}'),
    ('Software Installation', 'Request installation of approved software.', 'Software', 0.00, 1, false, 'desktop-support',
     '{"fields": [{"name": "software_name", "type": "text", "label": "Software Name", "required": true}, {"name": "version", "type": "text", "label": "Version (if specific)"}, {"name": "license_key", "type": "text", "label": "License Key (if you have one)"}]}'),
    ('VPN Access', 'Request VPN access for remote work.', 'Access', 0.00, 1, true, 'network-ops',
     '{"fields": [{"name": "vpn_type", "type": "select", "label": "VPN Type", "required": true, "options": ["Full Tunnel", "Split Tunnel"]}, {"name": "duration", "type": "select", "label": "Duration", "required": true, "options": ["Permanent", "30 Days", "90 Days"]}]}'),
    ('Distribution List', 'Create or modify an email distribution list.', 'Communication', 0.00, 1, false, 'app-support',
     '{"fields": [{"name": "list_name", "type": "text", "label": "List Name", "required": true}, {"name": "members", "type": "textarea", "label": "Initial Members (one email per line)"}]}'),
    ('New User Account', 'Provision a new user account for an employee.', 'Access', 0.00, 2, true, 'service-desk',
     '{"fields": [{"name": "employee_name", "type": "text", "label": "Employee Full Name", "required": true}, {"name": "department", "type": "text", "label": "Department", "required": true}, {"name": "start_date", "type": "date", "label": "Start Date", "required": true}, {"name": "manager_email", "type": "text", "label": "Manager Email", "required": true}]}'),
    ('Password Reset', 'Reset your password for any system.', 'Access', 0.00, 0, false, 'service-desk',
     '{"fields": [{"name": "system", "type": "text", "label": "System/Application", "required": true}, {"name": "username", "type": "text", "label": "Username", "required": true}]}'),
    ('General IT Request', 'Any IT request not covered by other catalog items.', 'General', 0.00, 3, false, 'service-desk',
     '{"fields": [{"name": "details", "type": "textarea", "label": "Describe your request in detail", "required": true}]}')
) AS item(name, description, category, price, delivery_days, approval_required, team_slug, form_schema);
