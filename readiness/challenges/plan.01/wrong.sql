SELECT c.customer_id, count(*)::BIGINT AS order_count FROM customers c LEFT JOIN orders o USING(customer_id) GROUP BY c.customer_id ORDER BY c.customer_id;
