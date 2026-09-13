SELECT o.order_id,
  coalesce((SELECT sum(i.qty * i.unit_price) FROM order_items i
    WHERE i.order_id = o.order_id), 0)::DECIMAL(38,2) AS gross_revenue,
  coalesce((SELECT sum(p.amount) FROM payments p
    WHERE p.order_id = o.order_id AND p.status = 'succeeded'), 0)::DECIMAL(38,2) AS paid_amount
FROM orders o ORDER BY o.order_id;
