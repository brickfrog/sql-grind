SELECT customer_id FROM cohort_a INTERSECT ALL SELECT customer_id FROM cohort_b ORDER BY customer_id NULLS LAST;
