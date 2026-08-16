CREATE TABLE `schedule_runs` (
	`key` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`detail` text,
	PRIMARY KEY(`key`, `started_at`)
);
--> statement-breakpoint
CREATE TABLE `schedule_state` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled_override` integer,
	`cadence_override` text,
	`next_run_at` integer NOT NULL,
	`last_run_at` integer,
	`last_status` text,
	`last_error` text,
	`backoff_until` integer
);
--> statement-breakpoint
CREATE TABLE `user_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`cadence` text NOT NULL,
	`risk` text,
	`created_at` integer NOT NULL
);
