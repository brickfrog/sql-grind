-- Schema commerce-v1. Run in a fresh, disposable DuckDB database.
SET TimeZone = 'UTC';

CREATE TABLE categories (
    category_id BIGINT PRIMARY KEY CHECK (category_id > 0),
    parent_category_id BIGINT REFERENCES categories(category_id),
    c_name VARCHAR NOT NULL CHECK (length(c_name) > 0),
    CHECK (parent_category_id IS NULL OR parent_category_id < category_id)
);

CREATE TABLE customers (
    customer_id BIGINT PRIMARY KEY CHECK (customer_id > 0),
    customer_name VARCHAR NOT NULL,
    email VARCHAR,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE warehouses (
    warehouse_id BIGINT PRIMARY KEY CHECK (warehouse_id > 0),
    warehouse_name VARCHAR NOT NULL,
    route_to_warehouse_id BIGINT REFERENCES warehouses(warehouse_id),
    route_minutes INTEGER NOT NULL CHECK (route_minutes >= 0),
    CHECK (route_to_warehouse_id IS NULL OR route_to_warehouse_id < warehouse_id),
    CHECK ((route_to_warehouse_id IS NULL AND route_minutes = 0)
        OR (route_to_warehouse_id IS NOT NULL AND route_minutes > 0))
);

CREATE TABLE products (
    product_id BIGINT PRIMARY KEY CHECK (product_id > 0),
    category_id BIGINT NOT NULL REFERENCES categories(category_id),
    product_name VARCHAR NOT NULL,
    unit_price DECIMAL(18,2) NOT NULL CHECK (unit_price BETWEEN 0 AND 999999.99),
    active BOOLEAN NOT NULL
);

CREATE TABLE orders (
    order_id BIGINT PRIMARY KEY CHECK (order_id > 0),
    customer_id BIGINT NOT NULL REFERENCES customers(customer_id),
    warehouse_id BIGINT NOT NULL REFERENCES warehouses(warehouse_id),
    ordered_at TIMESTAMPTZ NOT NULL,
    status VARCHAR NOT NULL CHECK (status IN ('pending', 'paid', 'cancelled', 'refunded'))
);

CREATE TABLE order_items (
    order_item_id BIGINT PRIMARY KEY CHECK (order_item_id > 0),
    order_id BIGINT NOT NULL REFERENCES orders(order_id),
    product_id BIGINT NOT NULL REFERENCES products(product_id),
    qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 1000),
    unit_price DECIMAL(18,2) NOT NULL CHECK (unit_price BETWEEN 0 AND 999999.99)
);

CREATE TABLE payments (
    payment_id BIGINT PRIMARY KEY CHECK (payment_id > 0),
    order_id BIGINT NOT NULL REFERENCES orders(order_id),
    paid_at TIMESTAMPTZ,
    status VARCHAR NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed')),
    amount DECIMAL(18,2) NOT NULL CHECK (amount >= 0),
    CHECK ((status = 'succeeded' AND paid_at IS NOT NULL)
        OR (status IN ('pending', 'failed') AND paid_at IS NULL))
);

CREATE TABLE returns (
    return_id BIGINT PRIMARY KEY CHECK (return_id > 0),
    order_item_id BIGINT NOT NULL REFERENCES order_items(order_item_id),
    qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 1000),
    reason VARCHAR NOT NULL CHECK (reason IN ('damaged', 'wrong_item', 'unwanted')),
    status VARCHAR NOT NULL CHECK (status IN ('requested', 'refunded', 'rejected')),
    requested_at TIMESTAMPTZ NOT NULL,
    refunded_at TIMESTAMPTZ,
    refund_amount DECIMAL(18,2) NOT NULL CHECK (refund_amount >= 0),
    CHECK ((status = 'refunded' AND refunded_at IS NOT NULL AND refunded_at >= requested_at)
        OR (status IN ('requested', 'rejected') AND refunded_at IS NULL AND refund_amount = 0))
);
