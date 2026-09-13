CREATE TABLE category_edges(parent_id BIGINT,child_id BIGINT,PRIMARY KEY(parent_id,child_id));
CREATE TABLE route_edges(from_id BIGINT,to_id BIGINT,minutes BIGINT NOT NULL CHECK(minutes>=0),PRIMARY KEY(from_id,to_id));
