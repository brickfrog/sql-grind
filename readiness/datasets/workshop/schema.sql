CREATE TABLE cohort_a(customer_id BIGINT);
CREATE TABLE cohort_b(customer_id BIGINT);
CREATE TABLE return_requests(customer_id BIGINT);
CREATE TABLE cohort_customers(customer_id BIGINT PRIMARY KEY);
CREATE TABLE daily_events(event_id BIGINT PRIMARY KEY,event_date DATE NOT NULL,amount DECIMAL(18,2) NOT NULL);
CREATE TABLE monthly_matrix(mon DATE PRIMARY KEY,damaged BIGINT,wrong_item BIGINT,unwanted BIGINT);
CREATE TABLE return_totals(mon DATE,reason VARCHAR,qty BIGINT NOT NULL,PRIMARY KEY(mon,reason));
CREATE TABLE raw_contacts(contact_id BIGINT PRIMARY KEY,name_text VARCHAR,email_text VARCHAR,postal_text VARCHAR,tags_text VARCHAR,date_text VARCHAR);
