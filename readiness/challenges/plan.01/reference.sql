SELECT c.customer_id, count(o.order_id)::BIGINT AS order_count
FROM customers c LEFT JOIN orders o ON o.customer_id = c.customer_id
GROUP BY c.customer_id ORDER BY c.customer_id;
