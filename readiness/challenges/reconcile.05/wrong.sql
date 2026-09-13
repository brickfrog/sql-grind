SELECT ref_id,'[]'::VARCHAR AS partner_ids,'missing'::VARCHAR AS confidence,0::DECIMAL(5,4) AS score,'No commitment was made.'::VARCHAR AS explanation FROM reference_events ORDER BY ref_id;
