INSERT INTO cohort_a VALUES (1),(1),(2),(NULL),(NULL),(4);
INSERT INTO cohort_b VALUES (1),(3),(NULL),(NULL),(NULL);
INSERT INTO return_requests VALUES (1),(NULL),(1);
INSERT INTO cohort_customers VALUES (1),(2),(3),(4);
INSERT INTO daily_events VALUES (1,'2024-01-01',10.00),(2,'2024-01-01',20.00),(3,'2024-01-02',5.00);
INSERT INTO monthly_matrix VALUES ('2024-01-01',2,NULL,0),('2024-02-01',NULL,3,1),('2024-03-01',0,0,0);
INSERT INTO return_totals VALUES ('2024-01-01','damaged',2),('2024-01-01','wrong_item',0),('2024-02-01','unwanted',3);
INSERT INTO raw_contacts VALUES
(1,' Ari ',NULL,'12345','red,Blue,red,,','2024-02-29'),
(2,'ARI','   ','12345-6789',' blue , green ','02/03/2024'),
(3,'Zoë',' person@example.invalid ','1234',NULL,'29 Feb 2024'),
(4,'Zoe','','123456','','2024-02-30'),
(5,NULL,'UPPER@example.invalid',NULL,'red,red',NULL),
(6,'  ','x@example.invalid',' 12345 ',', ,','31/12/2024');
