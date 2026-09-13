SELECT count(*) AS customer_count,count(nullif(email,'')) AS populated_email_count FROM customers;
