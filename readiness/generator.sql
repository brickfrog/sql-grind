-- Generator commerce-generator-v1. Requires empty commerce-v1 tables.
-- Optional caller configuration before this file:
-- SET VARIABLE dataset_scale = 'illustrated'; -- default: 'small'
-- SET VARIABLE dataset_seed = 20240907;       -- integer in [0, 2147483646]
-- No random(), hash(), current timestamp, files, extensions, or client dependencies.
SET TimeZone = 'UTC';
CREATE TEMP TABLE generator_config AS
WITH input AS (
    SELECT coalesce(getvariable('dataset_scale'), 'small')::VARCHAR AS scale,
           coalesce(getvariable('dataset_seed'), 20240907)::BIGINT AS seed
)
SELECT
    CASE WHEN scale IN ('small', 'illustrated') THEN scale
         ELSE error('dataset_scale must be small or illustrated') END AS scale,
    CASE WHEN seed BETWEEN 0 AND 2147483646 THEN seed
         ELSE error('dataset_seed must be in [0, 2147483646]') END AS seed,
    CASE WHEN scale = 'illustrated' THEN 120000 ELSE 500 END::BIGINT AS customers_n,
    CASE WHEN scale = 'illustrated' THEN 12000 ELSE 240 END::BIGINT AS products_n,
    CASE WHEN scale = 'illustrated' THEN 1400000 ELSE 2000 END::BIGINT AS orders_n,
    CASE WHEN scale = 'illustrated' THEN 5900000 ELSE 8500 END::BIGINT AS items_n,
    CASE WHEN scale = 'illustrated' THEN 1500000 ELSE 2100 END::BIGINT AS payments_n,
    CASE WHEN scale = 'illustrated' THEN 88000 ELSE 126 END::BIGINT AS returns_n
FROM input;

INSERT INTO categories
SELECT i, NULL, 'Department ' || i::VARCHAR FROM range(1, 9) r(i);
INSERT INTO categories
SELECT i, 1 + ((i - 9) % 8),
       CASE WHEN i IN (9, 10) THEN 'Shared category' ELSE 'Category ' || i::VARCHAR END
FROM range(9, 49) r(i);
INSERT INTO warehouses VALUES (1, 'Central', NULL, 0);
INSERT INTO warehouses
SELECT i, 'Regional ' || i::VARCHAR, 1, (i * 5)::INTEGER FROM range(2, 8) r(i);
INSERT INTO warehouses
SELECT i, 'Local ' || i::VARCHAR, 2 + ((i - 8) % 6), ((i % 4 + 1) * 5)::INTEGER
FROM range(8, 15) r(i);

INSERT INTO customers
SELECT i, 'Customer ' || i::VARCHAR,
       CASE WHEN i % 11 = 0 THEN NULL ELSE 'customer' || i::VARCHAR || '@example.invalid' END,
       TIMESTAMPTZ '2022-01-01 00:00:00+00' + ((i * 48271 + seed) % 31536000) * INTERVAL '1 second'
FROM generator_config g, LATERAL range(1, g.customers_n + 1) r(i);

INSERT INTO products
SELECT i, 9 + (((i * 48271 + seed) % 2147483647) % 39), 'Product ' || i::VARCHAR,
       CAST((100 + ((i * 69621 + seed) % 99900)) * CAST(0.01 AS DECIMAL(3,2)) AS DECIMAL(18,2)),
       i % 17 <> 0
FROM generator_config g, LATERAL range(1, g.products_n + 1) r(i);

INSERT INTO orders
SELECT i, 1 + (((i * 48271 + seed) % 2147483647) % customers_n), 1 + ((i - 1) % 14),
       TIMESTAMPTZ '2023-12-01 00:00:00+00'
           + (((i * 69621 + seed) % 2147483647) % (427 * 86400)) * INTERVAL '1 second',
       CASE i % 10 WHEN 0 THEN 'pending' WHEN 1 THEN 'cancelled'
            WHEN 2 THEN 'refunded' ELSE 'paid' END
FROM generator_config g, LATERAL range(1, g.orders_n + 1) r(i);

INSERT INTO order_items
SELECT i, 1 + ((i - 1) % orders_n),
       1 + (((i * 48271 + seed) % 2147483647) % products_n),
       (1 + ((i * 17 + seed) % 5))::INTEGER,
       CAST((25 + (((i * 69621 + seed) % 2147483647) % 99975))
           * CAST(0.01 AS DECIMAL(3,2)) AS DECIMAL(18,2))
FROM generator_config g, LATERAL range(1, g.items_n + 1) r(i);

-- Payment rows describe attempts, not a reconciled accounting ledger.
INSERT INTO payments
SELECT i, o.order_id,
       CASE WHEN i % 7 NOT IN (0, 1) THEN o.ordered_at + INTERVAL '1 minute' ELSE NULL END,
       CASE i % 7 WHEN 0 THEN 'failed' WHEN 1 THEN 'pending' ELSE 'succeeded' END,
       CAST((100 + ((i * 48271 + seed) % 499900))
           * CAST(0.01 AS DECIMAL(3,2)) AS DECIMAL(18,2))
FROM generator_config g, LATERAL range(1, g.payments_n + 1) r(i)
JOIN orders o ON o.order_id = 1 + ((i - 1) % orders_n);

INSERT INTO returns
SELECT i, oi.order_item_id, 1,
       CASE i % 3 WHEN 0 THEN 'damaged' WHEN 1 THEN 'wrong_item' ELSE 'unwanted' END,
       CASE i % 5 WHEN 0 THEN 'requested' WHEN 1 THEN 'rejected' ELSE 'refunded' END,
       o.ordered_at + INTERVAL '7 days',
       CASE WHEN i % 5 NOT IN (0, 1) THEN o.ordered_at + INTERVAL '8 days' ELSE NULL END,
       CASE WHEN i % 5 NOT IN (0, 1) THEN oi.unit_price ELSE CAST(0 AS DECIMAL(18,2)) END
FROM generator_config g, LATERAL range(1, g.returns_n + 1) r(i)
JOIN order_items oi ON oi.order_item_id = i
JOIN orders o ON o.order_id = oi.order_id;

DROP TABLE generator_config;
