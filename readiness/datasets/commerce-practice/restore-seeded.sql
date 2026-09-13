-- The unchanged commerce schema is recreated before this restoration step.
-- Insert self-referencing parents before their descendants.
INSERT INTO categories SELECT * FROM practice_saved_categories WHERE parent_category_id IS NULL ORDER BY category_id;
INSERT INTO categories SELECT * FROM practice_saved_categories WHERE parent_category_id IS NOT NULL ORDER BY category_id;
INSERT INTO customers SELECT * FROM practice_saved_customers ORDER BY customer_id;
INSERT INTO warehouses SELECT * FROM practice_saved_warehouses WHERE route_to_warehouse_id IS NULL ORDER BY warehouse_id;
INSERT INTO warehouses SELECT * FROM practice_saved_warehouses WHERE route_to_warehouse_id=1 ORDER BY warehouse_id;
INSERT INTO warehouses SELECT * FROM practice_saved_warehouses WHERE route_to_warehouse_id IS NOT NULL AND route_to_warehouse_id<>1 ORDER BY warehouse_id;
INSERT INTO products SELECT * FROM practice_saved_products ORDER BY product_id;
INSERT INTO orders SELECT * FROM practice_saved_orders ORDER BY order_id;
INSERT INTO order_items SELECT * FROM practice_saved_order_items ORDER BY order_item_id;
INSERT INTO payments SELECT * FROM practice_saved_payments ORDER BY payment_id;
INSERT INTO returns SELECT * FROM practice_saved_returns ORDER BY return_id;
DROP TABLE practice_saved_categories;
DROP TABLE practice_saved_customers;
DROP TABLE practice_saved_warehouses;
DROP TABLE practice_saved_products;
DROP TABLE practice_saved_orders;
DROP TABLE practice_saved_order_items;
DROP TABLE practice_saved_payments;
DROP TABLE practice_saved_returns;
DROP TABLE practice_category_map;
DROP TABLE practice_order_shift;
