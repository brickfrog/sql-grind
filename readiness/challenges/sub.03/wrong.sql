SELECT customer_id FROM cohort_customers WHERE customer_id NOT IN (SELECT customer_id FROM return_requests) ORDER BY customer_id;
