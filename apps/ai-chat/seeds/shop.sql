-- Demo shop data: 12 products, 80 customers, 900 orders over the last year.
-- Deterministic and idempotent (re-running inserts nothing new). Dates are
-- relative to the day it first loads, so "last month" always has data.

INSERT INTO products (short_guid, name, category, price) VALUES
  ('prd_01', 'Trail Runner Shoes',      'Footwear',    129.00),
  ('prd_02', 'Everyday Sneakers',       'Footwear',     79.00),
  ('prd_03', 'Waterproof Hiking Boots', 'Footwear',    189.00),
  ('prd_04', 'Merino Base Layer',       'Apparel',      89.00),
  ('prd_05', 'Rain Shell Jacket',       'Apparel',     219.00),
  ('prd_06', 'Fleece Pullover',         'Apparel',      69.00),
  ('prd_07', 'Daypack 22L',             'Gear',         95.00),
  ('prd_08', 'Insulated Bottle',        'Gear',         32.00),
  ('prd_09', 'Headlamp',                'Gear',         45.00),
  ('prd_10', 'Trekking Poles',          'Gear',        119.00),
  ('prd_11', 'Wool Socks (3 pack)',     'Accessories',  29.00),
  ('prd_12', 'Sun Hat',                 'Accessories',  35.00)
ON CONFLICT (short_guid) DO NOTHING;

INSERT INTO customers (short_guid, name, city, country, segment, joined_on)
SELECT
  'cus_' || lpad(g::text, 4, '0'),
  (ARRAY['Ana','Ben','Chloe','Dev','Elena','Felix','Grace','Hiro','Ines','Jonas','Kara','Liam','Maya','Noah','Olga','Priya'])[1 + (g * 7) % 16]
    || ' ' || (ARRAY['Silva','Okafor','Martin','Kumar','Rossi','Schmidt','Chen','Tanaka','Garcia','Berg','Novak','Walsh'])[1 + (g * 5) % 12],
  (ARRAY['Seattle','Austin','Toronto','London','Berlin','Sydney','Denver','Vancouver','Dublin','Munich'])[1 + (g * 3) % 10],
  (ARRAY['US','US','CA','UK','DE','AU','US','CA','IE','DE'])[1 + (g * 3) % 10],
  CASE WHEN g % 5 = 0 THEN 'business' ELSE 'consumer' END,
  CURRENT_DATE - ((g * 11) % 700)
FROM generate_series(1, 80) AS g
ON CONFLICT (short_guid) DO NOTHING;

INSERT INTO orders (short_guid, customer_guid, ordered_at, status, channel)
SELECT
  'ord_' || lpad(g::text, 5, '0'),
  'cus_' || lpad((1 + (g * 37) % 80)::text, 4, '0'),
  date_trunc('day', NOW()) - make_interval(days => (g * 13) % 365, hours => (g * 7) % 24),
  CASE
    WHEN (g * 13) % 365 < 3 THEN 'processing'
    WHEN (g * 13) % 365 < 8 THEN 'shipped'
    WHEN g % 23 = 0 THEN 'cancelled'
    WHEN g % 31 = 0 THEN 'refunded'
    ELSE 'delivered'
  END,
  (ARRAY['web','web','mobile','marketplace'])[1 + g % 4]
FROM generate_series(1, 900) AS g
ON CONFLICT (short_guid) DO NOTHING;

INSERT INTO order_items (order_guid, line, product_guid, quantity, unit_price)
SELECT
  'ord_' || lpad(g::text, 5, '0'),
  k,
  p.short_guid,
  1 + (g + k) % 3,
  p.price
FROM generate_series(1, 900) AS g
CROSS JOIN LATERAL generate_series(1, 1 + g % 3) AS k
JOIN products p ON p.short_guid = 'prd_' || lpad((1 + (g * 5 + k * 7) % 12)::text, 2, '0')
ON CONFLICT (order_guid, line) DO NOTHING;
