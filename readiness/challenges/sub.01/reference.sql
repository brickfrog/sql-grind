SELECT p.product_id,p.unit_price::DECIMAL(38,2) AS unit_price FROM products p WHERE p.unit_price*(SELECT count(*) FROM products)>(SELECT sum(unit_price) FROM products) ORDER BY p.product_id;
