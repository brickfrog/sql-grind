-- Every row must report zero violations before dataset publication.
SELECT 'product_nonleaf' AS invariant, count(*) AS violations FROM products p WHERE EXISTS (SELECT 1 FROM categories c WHERE c.parent_category_id=p.category_id)
UNION ALL SELECT 'customer_after_order',count(*) FROM orders o JOIN customers c USING(customer_id) WHERE c.created_at>o.ordered_at
UNION ALL SELECT 'return_before_order',count(*) FROM returns r JOIN order_items i USING(order_item_id) JOIN orders o USING(order_id) WHERE r.requested_at<o.ordered_at
UNION ALL SELECT 'return_quantity',count(*) FROM (SELECT r.order_item_id FROM returns r JOIN order_items i USING(order_item_id) GROUP BY r.order_item_id,i.qty HAVING sum(CASE WHEN r.status<>'rejected' THEN r.qty ELSE 0 END)>i.qty)
UNION ALL SELECT 'refund_amount',count(*) FROM (SELECT r.order_item_id FROM returns r JOIN order_items i USING(order_item_id) GROUP BY r.order_item_id,i.qty,i.unit_price HAVING sum(r.refund_amount)>i.qty*i.unit_price)
UNION ALL SELECT 'payment_before_order',count(*) FROM payments p JOIN orders o USING(order_id) WHERE p.paid_at<o.ordered_at;
