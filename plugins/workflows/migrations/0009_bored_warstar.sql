ALTER TABLE `workflow_schedules` ADD `scheduler_key` text;--> statement-breakpoint
ALTER TABLE `workflow_schedules` ADD `loops_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_schedules_scheduler_key_unique` ON `workflow_schedules` (`scheduler_key`);