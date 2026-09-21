-- Lifecycle checkpoints used the general observation kind before review inputs had a dedicated
-- kind. Reclassify only rows written through the lifecycle producer boundary; agent-recorded
-- findings use a different producer ID and remain ordinary observations.
UPDATE `observations`
SET
	`kind_id` = 'findings:review-input',
	`kind_label` = 'Review input'
WHERE `kind_id` = 'findings:observation'
	AND `producer_id` LIKE 'lifecycle:%';
