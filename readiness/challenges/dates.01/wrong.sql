SELECT order_id,(ordered_at>=TIMESTAMPTZ '2024-01-01 00:00:00+00' AND ordered_at<=TIMESTAMPTZ '2025-01-01 00:00:00+00') AS in_reporting_year FROM orders ORDER BY order_id;
