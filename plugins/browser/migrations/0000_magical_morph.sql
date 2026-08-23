CREATE TABLE `browser_captures` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`body` blob NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `browser_captures_task_idx` ON `browser_captures` (`task_id`,`created_at`);