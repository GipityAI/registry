-- 005-catalog-requests.sql
-- Service catalog and service requests

CREATE TABLE IF NOT EXISTS catalog_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    icon VARCHAR(50),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS catalog_items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(300) NOT NULL,
    description TEXT,
    category_id INTEGER REFERENCES catalog_categories(id) ON DELETE SET NULL,
    price DECIMAL(10,2),
    delivery_days INTEGER NOT NULL DEFAULT 1,
    approval_required BOOLEAN NOT NULL DEFAULT false,
    fulfillment_team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    form_schema JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    order_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_catalog_items_category ON catalog_items(category_id);

CREATE SEQUENCE IF NOT EXISTS service_requests_number_seq START WITH 1000;

CREATE TABLE IF NOT EXISTS service_requests (
    id SERIAL PRIMARY KEY,
    number VARCHAR(20) NOT NULL UNIQUE DEFAULT 'REQ' || LPAD(nextval('service_requests_number_seq')::text, 7, '0'),
    catalog_item_id INTEGER REFERENCES catalog_items(id) ON DELETE SET NULL,
    requested_by VARCHAR(50) NOT NULL,
    requested_by_name VARCHAR(200),
    state VARCHAR(30) NOT NULL DEFAULT 'pending',
    approval_state VARCHAR(30) NOT NULL DEFAULT 'not_required',
    team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL,
    assigned_to VARCHAR(50),
    form_data JSONB,
    quantity INTEGER NOT NULL DEFAULT 1,
    notes TEXT,
    fulfilled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_service_requests_requested_by ON service_requests(requested_by, state);
CREATE INDEX IF NOT EXISTS idx_service_requests_team ON service_requests(team_id, state);
