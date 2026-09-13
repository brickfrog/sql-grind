SET TimeZone = 'UTC';
CREATE TABLE lookup_orders (order_id BIGINT PRIMARY KEY, customer_id BIGINT NOT NULL, amount DECIMAL(18,2) NOT NULL);
