INSERT INTO lookup_orders SELECT order_id, (order_id % 1000) + 1, ((order_id % 10000)::DECIMAL(18,2)) / 100 FROM range(1, 100001) AS ids(order_id);
