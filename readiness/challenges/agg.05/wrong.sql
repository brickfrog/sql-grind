SELECT email,(email IS NULL)::BIGINT AS is_total,count(*) AS customer_count FROM customers GROUP BY GROUPING SETS ((email),()) ORDER BY is_total,email NULLS LAST;
