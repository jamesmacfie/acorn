CREATE TABLE `terminal_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`exit_code` integer,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `terminal_runs_task_idx` ON `terminal_runs` (`task_id`);--> statement-breakpoint
CREATE INDEX `terminal_runs_finished_idx` ON `terminal_runs` (`finished_at`);