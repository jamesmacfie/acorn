CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`session_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`task_id` text NOT NULL,
	`status` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `turn_id`)
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`, `created_at`);
--> statement-breakpoint
CREATE TABLE `notes` (
	`session_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`task_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`severity` text NOT NULL,
	`note` text NOT NULL,
	`outcome` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `turn_id`)
);
