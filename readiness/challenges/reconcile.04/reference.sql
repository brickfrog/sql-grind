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
), partner_sets AS (
 SELECT ref_id,[partner_id] AS ids,partner_id AS last_id,partner_quantity AS qty FROM pair_scores
 UNION ALL
 SELECT s.ref_id,list_append(s.ids,p.partner_id),p.partner_id,s.qty+p.partner_quantity
 FROM partner_sets s JOIN pair_scores p ON p.ref_id=s.ref_id AND p.partner_id>s.last_id WHERE len(s.ids)<3
), reference_sets AS (
 SELECT partner_id,[ref_id] AS ids,ref_id AS last_id,ref_quantity AS qty FROM pair_scores
 UNION ALL
 SELECT s.partner_id,list_append(s.ids,p.ref_id),p.ref_id,s.qty+p.ref_quantity
 FROM reference_sets s JOIN pair_scores p ON p.partner_id=s.partner_id AND p.ref_id>s.last_id WHERE len(s.ids)<3
), group_members AS (
 SELECT 'r:'||ref_id::VARCHAR||'|p:'||partner_id::VARCHAR AS group_key,ref_id,partner_id FROM pair_scores
 UNION ALL
 SELECT 'r:'||s.ref_id::VARCHAR||'|p:'||array_to_string(s.ids,','),s.ref_id,p.partner_id
 FROM partner_sets s JOIN pair_scores p ON p.ref_id=s.ref_id AND list_contains(s.ids,p.partner_id)
 WHERE len(s.ids)>1 AND s.qty=p.ref_quantity
 UNION ALL
 SELECT 'r:'||array_to_string(s.ids,',')||'|p:'||s.partner_id::VARCHAR,p.ref_id,s.partner_id
 FROM reference_sets s JOIN pair_scores p ON p.partner_id=s.partner_id AND list_contains(s.ids,p.ref_id)
 WHERE len(s.ids)>1 AND s.qty=p.partner_quantity
), group_evidence AS (
 SELECT g.group_key,min(p.text_points)::BIGINT AS text_points,min(p.date_points)::BIGINT AS date_points,
 CASE WHEN count(*)>1 THEN 30 ELSE min(p.quantity_points) END::BIGINT AS quantity_points,
 min(p.category_points)::BIGINT AS category_points,min(p.word_points)::BIGINT AS word_points
 FROM group_members g JOIN pair_scores p USING(ref_id,partner_id) GROUP BY g.group_key
), group_scores AS (
 SELECT *, (text_points+date_points+quantity_points+category_points+word_points)::BIGINT AS score FROM group_evidence
), reference_groups AS (
 SELECT DISTINCT m.ref_id,m.group_key,s.score FROM group_members m JOIN group_scores s USING(group_key)
), ranked_groups AS (
 SELECT *,row_number() OVER(PARTITION BY ref_id ORDER BY score DESC,group_key) AS pos,
 lead(score,1,0) OVER(PARTITION BY ref_id ORDER BY score DESC,group_key) AS second_score FROM reference_groups
), provisional AS (
 SELECT r.ref_id,b.group_key,coalesce(b.score,0)::BIGINT AS score,coalesce(b.score-b.second_score,0)::BIGINT AS margin,
 CASE WHEN coalesce(b.score,0)<75 THEN 'missing' WHEN b.score-b.second_score<10 THEN 'ambiguous' WHEN b.score>=90 THEN 'high' ELSE 'probable' END AS confidence
 FROM reference_events r LEFT JOIN ranked_groups b ON b.ref_id=r.ref_id AND b.pos=1
), conflicts AS (
 SELECT DISTINCT a.group_key FROM provisional a JOIN provisional b ON a.group_key<>b.group_key
 JOIN group_members x ON x.group_key=a.group_key JOIN group_members y ON y.group_key=b.group_key
 WHERE a.confidence IN ('high','probable') AND b.confidence IN ('high','probable') AND (x.ref_id=y.ref_id OR x.partner_id=y.partner_id)
), decisions AS (
 SELECT p.ref_id,CASE WHEN p.confidence IN ('high','probable') AND c.group_key IS NULL THEN p.group_key ELSE NULL END AS group_key,
 CASE WHEN c.group_key IS NOT NULL THEN 'ambiguous' ELSE p.confidence END AS confidence,p.score,p.margin
 FROM provisional p LEFT JOIN conflicts c ON c.group_key=p.group_key
)
SELECT ref_id,group_key,confidence,score,margin FROM decisions ORDER BY ref_id;
