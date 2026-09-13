SELECT order_item_id,CASE WHEN qty BETWEEN 1 AND 10 THEN 'small' WHEN qty BETWEEN 10 AND 99 THEN 'medium' ELSE 'large' END AS quantity_band FROM order_items ORDER BY order_item_id;
