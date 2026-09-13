SELECT contact_id,lower(trim(name_text)) AS normalized_name FROM raw_contacts ORDER BY contact_id;
