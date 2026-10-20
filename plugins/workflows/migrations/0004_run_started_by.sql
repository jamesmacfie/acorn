ALTER TABLE `workflow_runs` RENAME COLUMN "trigger" TO "started_by";--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `trigger_id` text;--> statement-breakpoint
UPDATE `workflow_runs` SET `started_by` = 'manual' WHERE `started_by` NOT IN ('manual', 'schedule', 'agent-tool', 'agent-map', 'reprocess');
