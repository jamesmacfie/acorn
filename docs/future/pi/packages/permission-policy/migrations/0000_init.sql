CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `explanations` (
	`session_id` text NOT NULL,
	`request_id` text NOT NULL,
	`task_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`session_id`, `request_id`)
);
