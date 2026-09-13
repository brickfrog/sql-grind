CREATE TABLE reference_events(ref_id BIGINT PRIMARY KEY, account_key VARCHAR, category VARCHAR NOT NULL, event_date DATE NOT NULL, description VARCHAR NOT NULL, quantity BIGINT NOT NULL CHECK(quantity>0), business_unit VARCHAR NOT NULL);
CREATE TABLE partner_events(partner_id BIGINT PRIMARY KEY, account_key VARCHAR, source_event_key VARCHAR, category_text VARCHAR, date_text VARCHAR, description_text VARCHAR, quantity BIGINT NOT NULL CHECK(quantity>0));
CREATE TABLE category_aliases(alias VARCHAR PRIMARY KEY, canonical VARCHAR NOT NULL);
INSERT INTO category_aliases VALUES ('hw','hardware'),('hard ware','hardware'),('hardware','hardware'),('supplies','supplies');
