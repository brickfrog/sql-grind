SELECT product_id,unit_price::DECIMAL(38,2) AS unit_price FROM products ORDER BY unit_price DESC,product_id ASC LIMIT 5;
