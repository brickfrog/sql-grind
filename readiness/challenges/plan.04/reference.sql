SELECT order_id, amount::DECIMAL(38,2) AS amount FROM lookup_orders WHERE customer_id = 42 ORDER BY order_id;
