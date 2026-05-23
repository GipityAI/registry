-- 001-categories.sql
-- Top-level incident categories and subcategories

-- Top-level categories
INSERT INTO categories (name, parent_id, module, sort_order) VALUES
    ('Hardware', NULL, 'incident', 1),
    ('Software', NULL, 'incident', 2),
    ('Network', NULL, 'incident', 3),
    ('Access & Permissions', NULL, 'incident', 4),
    ('Email & Communication', NULL, 'incident', 5),
    ('Other', NULL, 'incident', 6)
ON CONFLICT DO NOTHING;

-- Hardware subcategories
INSERT INTO categories (name, parent_id, module, sort_order)
SELECT sub.name, c.id, 'incident', sub.sort_order
FROM categories c,
(VALUES
    ('Laptop', 1),
    ('Desktop', 2),
    ('Monitor', 3),
    ('Keyboard/Mouse', 4),
    ('Printer', 5),
    ('Phone', 6)
) AS sub(name, sort_order)
WHERE c.name = 'Hardware' AND c.parent_id IS NULL
ON CONFLICT DO NOTHING;

-- Software subcategories
INSERT INTO categories (name, parent_id, module, sort_order)
SELECT sub.name, c.id, 'incident', sub.sort_order
FROM categories c,
(VALUES
    ('Operating System', 1),
    ('Office Apps', 2),
    ('Browser', 3),
    ('Business App', 4),
    ('Installation/Update', 5)
) AS sub(name, sort_order)
WHERE c.name = 'Software' AND c.parent_id IS NULL
ON CONFLICT DO NOTHING;

-- Network subcategories
INSERT INTO categories (name, parent_id, module, sort_order)
SELECT sub.name, c.id, 'incident', sub.sort_order
FROM categories c,
(VALUES
    ('Wi-Fi', 1),
    ('VPN', 2),
    ('Internet', 3),
    ('DNS', 4)
) AS sub(name, sort_order)
WHERE c.name = 'Network' AND c.parent_id IS NULL
ON CONFLICT DO NOTHING;

-- Access & Permissions subcategories
INSERT INTO categories (name, parent_id, module, sort_order)
SELECT sub.name, c.id, 'incident', sub.sort_order
FROM categories c,
(VALUES
    ('Password Reset', 1),
    ('Account Lockout', 2),
    ('New Account', 3),
    ('Permission Change', 4)
) AS sub(name, sort_order)
WHERE c.name = 'Access & Permissions' AND c.parent_id IS NULL
ON CONFLICT DO NOTHING;
