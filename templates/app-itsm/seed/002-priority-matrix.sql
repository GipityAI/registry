-- 002-priority-matrix.sql
-- 3x3 impact/urgency → priority mapping

INSERT INTO priority_matrix (impact, urgency, priority, priority_label) VALUES
    (1, 1, 1, 'Critical'),
    (1, 2, 2, 'High'),
    (1, 3, 3, 'Moderate'),
    (2, 1, 2, 'High'),
    (2, 2, 3, 'Moderate'),
    (2, 3, 4, 'Low'),
    (3, 1, 3, 'Moderate'),
    (3, 2, 4, 'Low'),
    (3, 3, 5, 'Planning')
ON CONFLICT DO NOTHING;
