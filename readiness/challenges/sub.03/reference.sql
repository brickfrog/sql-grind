SELECT c.customer_id FROM cohort_customers c WHERE NOT EXISTS (SELECT 1 FROM return_requests r WHERE r.customer_id=c.customer_id) ORDER BY c.customer_id;
