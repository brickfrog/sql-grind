SELECT order_id, amount::DECIMAL(38,2) AS amount FROM lookup_orders WHERE customer_id = 41 ORDER BY order_id;
