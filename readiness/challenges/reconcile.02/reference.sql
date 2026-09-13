WITH RECURSIVE
partner_text AS (
 SELECT *, nullif(lower(trim(account_key)), '') AS account,
   nullif(trim(source_event_key), '') AS event_key,
   trim(regexp_replace(lower(trim(category_text)), '[^\p{L}\p{N}]+', ' ', 'g')) AS cat,
   trim(regexp_replace(lower(trim(description_text)), '[^\p{L}\p{N}]+', ' ', 'g')) AS description,
   coalesce(
     CASE WHEN regexp_full_match(trim(date_text), '[0-9]{4}-[0-9]{2}-[0-9]{2}') THEN try_strptime(trim(date_text), '%Y-%m-%d') END,
     CASE WHEN regexp_full_match(trim(date_text), '[0-9]{2}/[0-9]{2}/[0-9]{4}') THEN try_strptime(trim(date_text), '%m/%d/%Y') END,
     CASE WHEN regexp_full_match(trim(date_text), '[0-9]{2} [A-Za-z]{3} [0-9]{4}') THEN try_strptime(trim(date_text), '%d %b %Y') END
   )::DATE AS parsed_date
 FROM partner_events
), normalized_partners AS (
 SELECT p.*, coalesce(a.canonical,p.cat) AS normalized_category
 FROM partner_text p LEFT JOIN category_aliases a ON a.alias=p.cat
 WHERE p.event_key IS NULL OR p.partner_id=(SELECT min(q.partner_id) FROM partner_text q WHERE q.event_key=p.event_key)
), normalized_references AS (
 SELECT *, nullif(lower(trim(account_key)), '') AS account,
 trim(regexp_replace(lower(trim(description)), '[^\p{L}\p{N}]+', ' ', 'g')) AS normalized_description,
 trim(regexp_replace(lower(trim(category)), '[^\p{L}\p{N}]+', ' ', 'g')) AS normalized_category
 FROM reference_events
), candidates AS (
 SELECT r.ref_id, p.partner_id, p.normalized_category, p.parsed_date, p.description AS normalized_description,
 r.quantity AS ref_quantity,p.quantity AS partner_quantity,
 CASE WHEN p.description IS NULL OR p.description='' OR r.normalized_description='' THEN 0
      WHEN levenshtein(r.normalized_description,p.description)<=2 THEN 30
      WHEN levenshtein(r.normalized_description,p.description)<=5 THEN 15 ELSE 0 END::BIGINT AS text_points,
 CASE abs(date_diff('day',r.event_date,p.parsed_date)) WHEN 0 THEN 20 WHEN 1 THEN 15 WHEN 2 THEN 10 WHEN 3 THEN 10 ELSE 0 END::BIGINT AS date_points,
 CASE abs(r.quantity-p.quantity) WHEN 0 THEN 30 WHEN 1 THEN 20 ELSE 0 END::BIGINT AS quantity_points,
 CASE WHEN r.normalized_category<>'' AND r.normalized_category=p.normalized_category THEN 10 ELSE 0 END::BIGINT AS category_points,
 CASE WHEN len(list_intersect(list_filter(string_split(r.normalized_description,' '), x -> x<>''),list_filter(string_split(coalesce(p.description,''),' '), x -> x<>'')))>=2 THEN 10 ELSE 0 END::BIGINT AS word_points
 FROM normalized_references r JOIN normalized_partners p ON r.account=p.account
), pair_scores AS (
 SELECT *, (text_points+date_points+quantity_points+category_points+word_points)::BIGINT AS score FROM candidates
)
SELECT ref_id,partner_id,text_points,date_points,quantity_points,category_points,word_points,score,rank() OVER(PARTITION BY ref_id ORDER BY score DESC)::BIGINT AS rnk FROM pair_scores ORDER BY ref_id,rnk,partner_id;
