INSERT INTO cohort_a VALUES (101),(101),(102),(NULL),(NULL),(104);
INSERT INTO cohort_b VALUES (101),(103),(NULL),(NULL),(NULL);
INSERT INTO return_requests VALUES (101),(NULL),(101);
INSERT INTO cohort_customers VALUES (101),(102),(103),(104);
INSERT INTO daily_events VALUES (101,'2024-02-01',10.00),(102,'2024-02-01',20.00),(103,'2024-02-02',5.00);
INSERT INTO monthly_matrix VALUES ('2024-02-01',2,NULL,0),('2024-03-01',NULL,3,1),('2024-04-01',0,0,0);
INSERT INTO return_totals VALUES ('2024-02-01','damaged',2),('2024-02-01','wrong_item',0),('2024-03-01','unwanted',3);
INSERT INTO raw_contacts VALUES
(101,' Bea ',NULL,'12345','red,Blue,red,,','2024-02-29'),
(102,'BEA','   ','12345-6789',' blue , green ','02/03/2024'),
(103,'Renée',' person@example.invalid ','1234',NULL,'29 Feb 2024'),
(104,'Renee','','123456','','2024-02-30'),
(105,NULL,'UPPER@example.invalid',NULL,'red,red',NULL),
(106,'  ','x@example.invalid',' 12345 ',', ,','31/12/2024');
