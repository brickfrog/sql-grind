SELECT p.product_id,p.unit_price FROM products p WHERE p.unit_price*(SELECT count(*) FROM order_items)>(SELECT sum(unit_price) FROM order_items) ORDER BY p.product_id;
