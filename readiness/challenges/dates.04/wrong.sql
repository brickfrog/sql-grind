SELECT order_id,(year(ordered_at AT TIME ZONE 'UTC')+CASE WHEN month(ordered_at AT TIME ZONE 'UTC')>=6 THEN 1 ELSE 0 END)::BIGINT AS fiscal_year FROM orders ORDER BY order_id;
