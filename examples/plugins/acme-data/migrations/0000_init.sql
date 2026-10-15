CREATE TABLE `deploys` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`environment` text NOT NULL,
	`status` text NOT NULL,
	`sha` text NOT NULL,
	`at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deploys_task` ON `deploys` (`task_id`);
