-- challenge-07-v1 / commerce-v1. Output order within (mon, rnk) peers is optional.
WITH monthly AS (
    SELECT
        CAST(date_trunc('month', o.ordered_at AT TIME ZONE 'UTC') AS DATE) AS mon,
        c.category_id,
        c.c_name,
        CAST(sum(CAST(oi.qty AS DECIMAL(18,0)) * oi.unit_price) AS DECIMAL(38,2)) AS revenue
    FROM orders AS o
    JOIN order_items AS oi ON oi.order_id = o.order_id
    JOIN products AS p ON p.product_id = oi.product_id
    JOIN categories AS c ON c.category_id = p.category_id
    WHERE o.status = 'paid'
      AND o.ordered_at >= TIMESTAMPTZ '2024-01-01 00:00:00+00'
      AND o.ordered_at < TIMESTAMPTZ '2025-01-01 00:00:00+00'
    GROUP BY mon, c.category_id, c.c_name
), ranked AS (
    SELECT mon, category_id, c_name, revenue,
        dense_rank() OVER (PARTITION BY mon ORDER BY revenue DESC) AS rnk
    FROM monthly
)
SELECT mon, category_id, c_name, revenue, rnk
FROM ranked
WHERE rnk <= 3
ORDER BY mon ASC, rnk ASC, category_id ASC;
