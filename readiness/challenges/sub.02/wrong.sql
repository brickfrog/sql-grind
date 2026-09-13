SELECT o.customer_id FROM orders o WHERE o.status = 'paid' AND o.ordered_at >= TIMESTAMPTZ '2024-01-01 00:00:00+00' AND o.ordered_at < TIMESTAMPTZ '2025-01-01 00:00:00+00' ORDER BY o.customer_id;
