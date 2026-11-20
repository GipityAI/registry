-- Demo data for the assistant to analyse: a small online shop. Replace these
-- tables with your own; the query_data tool reads whatever tables
-- functions/query-data.js is granted in gipity.yaml.
CREATE TABLE IF NOT EXISTS customers (
  short_guid VARCHAR(20) PRIMARY KEY,
  name       TEXT NOT NULL,
  city       TEXT NOT NULL,
  country    TEXT NOT NULL,
  segment    TEXT NOT NULL,            -- consumer | business
  joined_on  DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  short_guid VARCHAR(20) PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,
  price      NUMERIC(10, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  short_guid    VARCHAR(20) PRIMARY KEY,
  customer_guid VARCHAR(20) NOT NULL REFERENCES customers (short_guid),
  ordered_at    TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL,         -- delivered | shipped | processing | cancelled | refunded
  channel       TEXT NOT NULL          -- web | mobile | marketplace
);
CREATE INDEX IF NOT EXISTS orders_customer_idx ON orders (customer_guid);
CREATE INDEX IF NOT EXISTS orders_ordered_at_idx ON orders (ordered_at);

CREATE TABLE IF NOT EXISTS order_items (
  order_guid   VARCHAR(20) NOT NULL REFERENCES orders (short_guid),
  line         INTEGER NOT NULL,
  product_guid VARCHAR(20) NOT NULL REFERENCES products (short_guid),
  quantity     INTEGER NOT NULL,
  unit_price   NUMERIC(10, 2) NOT NULL,
  PRIMARY KEY (order_guid, line)
);
CREATE INDEX IF NOT EXISTS order_items_product_idx ON order_items (product_guid);
