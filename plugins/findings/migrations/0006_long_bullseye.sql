ALTER TABLE `finding_preparation_jobs` ADD `source_task_id` text;--> statement-breakpoint
ALTER TABLE `finding_preparation_jobs` ADD `model_id` text;--> statement-breakpoint
UPDATE `finding_preparation_jobs`
SET `source_task_id` = (
  SELECT `finding_lifecycle_checkpoints`.`task_id`
  FROM `finding_lifecycle_checkpoints`
  WHERE `finding_lifecycle_checkpoints`.`prepared_bundle_id` = `finding_preparation_jobs`.`bundle_id`
  LIMIT 1
)
WHERE `source_task_id` IS NULL;--> statement-breakpoint
UPDATE `finding_preparation_jobs`
SET `source_task_id` = (
  SELECT `observations`.`task_id`
  FROM `finding_preparation_inputs`
  INNER JOIN `observations` ON `observations`.`id` = `finding_preparation_inputs`.`observation_id`
  WHERE `finding_preparation_inputs`.`job_id` = `finding_preparation_jobs`.`id`
    AND `observations`.`task_id` IS NOT NULL
  ORDER BY `finding_preparation_inputs`.`ordinal`
  LIMIT 1
)
WHERE `source_task_id` IS NULL;
