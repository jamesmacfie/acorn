CREATE TABLE `task_script_attempts` (
	`attempt_id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`phase` text NOT NULL,
	`generation` integer NOT NULL,
	`state` text NOT NULL,
	`reason` text NOT NULL,
	`terminal_session_id` text,
	`requested_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`exit_code` integer,
	`output` text DEFAULT '' NOT NULL,
	`output_available` integer DEFAULT false NOT NULL,
	`output_truncated` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `task_script_attempts_task_generation` ON `task_script_attempts` (`task_id`,`generation`,`phase`);--> statement-breakpoint
ALTER TABLE `tasks` ADD `script_generation` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `script_history_known` integer DEFAULT true NOT NULL;
--> statement-breakpoint
UPDATE tasks SET script_history_known = 0;
