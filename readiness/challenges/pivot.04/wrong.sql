SELECT mon,reason,qty::BIGINT AS qty FROM monthly_matrix UNPIVOT (qty FOR reason IN (damaged,wrong_item,unwanted)) ORDER BY mon,reason;
