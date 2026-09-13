-- Preserve the seeded forest while reserving leaf identities 2, 3, and 7
-- for the fixed practice supplements. No ranking source asset is changed.
CREATE TEMP TABLE practice_category_map(old_id BIGINT PRIMARY KEY,new_id BIGINT NOT NULL);
INSERT INTO practice_category_map VALUES
(1,1),
(2,4),
(3,5),
(4,6),
(5,8),
(6,9),
(7,10),
(8,11),
(9,2),
(10,12),
(11,13),
(12,14),
(13,15),
(14,16),
(15,17),
(16,18),
(17,3),
(18,19),
(19,20),
(20,21),
(21,22),
(22,23),
(23,24),
(24,25),
(25,7),
(26,26),
(27,27),
(28,28),
(29,29),
(30,30),
(31,31),
(32,32),
(33,33),
(34,34),
(35,35),
(36,36),
(37,37),
(38,38),
(39,39),
(40,40),
(41,41),
(42,42),
(43,43),
(44,44),
(45,45),
(46,46),
(47,47),
(48,48);
CREATE TEMP TABLE practice_saved_categories AS SELECT * FROM categories;
CREATE TEMP TABLE practice_saved_customers AS SELECT * FROM customers;
CREATE TEMP TABLE practice_saved_warehouses AS SELECT * FROM warehouses;
CREATE TEMP TABLE practice_saved_products AS SELECT * FROM products;
CREATE TEMP TABLE practice_saved_orders AS SELECT * FROM orders;
CREATE TEMP TABLE practice_saved_order_items AS SELECT * FROM order_items;
CREATE TEMP TABLE practice_saved_payments AS SELECT * FROM payments;
CREATE TEMP TABLE practice_saved_returns AS SELECT * FROM returns;
UPDATE practice_saved_categories AS c SET category_id=m.new_id
FROM practice_category_map m WHERE c.category_id=m.old_id;
UPDATE practice_saved_categories AS c SET parent_category_id=m.new_id
FROM practice_category_map m WHERE c.parent_category_id=m.old_id;
UPDATE practice_saved_products AS p SET category_id=m.new_id
FROM practice_category_map m WHERE p.category_id=m.old_id;

-- Move only order 1, and only earlier. Its generated event offsets remain intact.
CREATE TEMP TABLE practice_order_shift AS
SELECT order_id,least(ordered_at,TIMESTAMPTZ '2024-01-01 00:00:00+00')-ordered_at AS delta
FROM orders WHERE order_id=1;
UPDATE practice_saved_orders AS o SET ordered_at=o.ordered_at+s.delta
FROM practice_order_shift s WHERE o.order_id=s.order_id;
UPDATE practice_saved_payments AS p SET paid_at=p.paid_at+s.delta
FROM practice_order_shift s WHERE p.order_id=s.order_id;
UPDATE practice_saved_returns AS r
SET requested_at=r.requested_at+s.delta,refunded_at=r.refunded_at+s.delta
FROM order_items i,practice_order_shift s
WHERE r.order_item_id=i.order_item_id AND i.order_id=s.order_id;

DROP TABLE returns;
DROP TABLE payments;
DROP TABLE order_items;
DROP TABLE orders;
DROP TABLE products;
DROP TABLE warehouses;
DROP TABLE customers;
DROP TABLE categories;
