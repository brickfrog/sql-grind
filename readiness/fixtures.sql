-- Dataset boundary-v1. Requires empty commerce-v1 tables.
-- Explicit statements keep self-referencing parents present before their children.
INSERT INTO categories VALUES (1, NULL, 'Store');
INSERT INTO categories VALUES
    (2, 1, 'Audio'), (3, 1, 'Audio'), (4, 1, 'Kitchen'),
    (5, 1, 'Outdoor'), (6, 1, 'Toys'), (7, 1, 'Empty');
INSERT INTO warehouses VALUES (1, 'Central', NULL, 0);
INSERT INTO warehouses VALUES (2, 'North', 1, 10), (3, 'South', 1, 20);
INSERT INTO warehouses VALUES (4, 'North Local', 2, 5);
INSERT INTO customers VALUES
    (1, 'Ari', NULL, TIMESTAMPTZ '2023-01-01 00:00:00+00'),
    (9007199254740993, 'Ari', 'ari@example.invalid', TIMESTAMPTZ '2023-06-01 00:00:00+00');
INSERT INTO products VALUES
    (2, 2, 'Speaker A', 777.77, true), (3, 3, 'Speaker B', 888.88, true),
    (4, 4, 'Kettle', 999.99, true), (5, 5, 'Tent', 555.55, true),
    (6, 6, 'Blocks', 444.44, false);
INSERT INTO orders VALUES
    (1, 1, 4, TIMESTAMPTZ '2023-12-31 19:00:00-05', 'paid'),
    (2, 9007199254740993, 2, TIMESTAMPTZ '2024-01-15 12:00:00+00', 'paid'),
    (3, 1, 1, TIMESTAMPTZ '2024-02-01 00:30:00+01', 'paid'),
    (4, 1, 3, TIMESTAMPTZ '2024-02-29 23:59:59+00', 'paid'),
    (5, 1, 1, TIMESTAMPTZ '2024-03-01 00:00:00+00', 'pending'),
    (6, 1, 1, TIMESTAMPTZ '2024-03-02 00:00:00+00', 'cancelled'),
    (7, 1, 1, TIMESTAMPTZ '2024-03-03 00:00:00+00', 'refunded'),
    (8, 1, 1, TIMESTAMPTZ '2024-04-01 00:00:00+00', 'paid'),
    (9, 1, 1, TIMESTAMPTZ '2025-01-01 00:30:00+01', 'paid'),
    (10, 1, 1, TIMESTAMPTZ '2024-12-31 19:00:00-05', 'paid'),
    (11, 1, 1, TIMESTAMPTZ '2023-12-31 23:59:59+00', 'paid'),
    (12, 1, 1, TIMESTAMPTZ '2024-01-20 00:00:00+00', 'paid');
INSERT INTO order_items VALUES
    (1, 1, 2, 3, 20.00), (2, 1, 2, 1, 20.00), (3, 1, 2, 1, 20.00),
    (4, 2, 3, 1, 100.00), (5, 2, 4, 1, 90.00),
    (6, 2, 5, 1, 90.00), (7, 2, 6, 1, 80.00),
    (8, 3, 6, 1, 0.00),
    (9, 4, 2, 1, 50.00), (10, 4, 3, 1, 40.00),
    (11, 4, 4, 1, 40.00), (12, 4, 5, 1, 30.00),
    (13, 5, 6, 1, 900.00), (14, 6, 6, 1, 900.00), (15, 7, 6, 1, 900.00),
    (16, 8, 6, 1, 0.00), (17, 9, 4, 2, 12.34),
    (18, 10, 6, 1, 999.89), (19, 11, 6, 1, 999.99);
INSERT INTO payments VALUES
    (1, 1, TIMESTAMPTZ '2024-01-01 00:01:00+00', 'succeeded', 60.00),
    (2, 1, TIMESTAMPTZ '2024-01-01 00:02:00+00', 'succeeded', 40.00),
    (3, 1, NULL, 'failed', 100.00),
    (4, 5, TIMESTAMPTZ '2024-03-01 00:01:00+00', 'succeeded', 900.00),
    (5, 6, NULL, 'pending', 900.00);
INSERT INTO returns VALUES
    (1, 1, 1, 'damaged', 'refunded', TIMESTAMPTZ '2024-01-02 00:00:00+00', TIMESTAMPTZ '2024-01-03 00:00:00+00', 20.00),
    (2, 1, 1, 'unwanted', 'refunded', TIMESTAMPTZ '2024-01-04 00:00:00+00', TIMESTAMPTZ '2024-01-05 00:00:00+00', 20.00),
    (3, 4, 1, 'wrong_item', 'rejected', TIMESTAMPTZ '2024-01-16 00:00:00+00', NULL, 0.00);
