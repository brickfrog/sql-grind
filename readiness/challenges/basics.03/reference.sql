SELECT customer_id,CASE WHEN email IS NULL THEN 'missing' WHEN email='' THEN 'empty' ELSE 'value' END AS email_state FROM customers ORDER BY customer_id;
