CREATE TABLE `plugin_model_calls` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`day` text NOT NULL,
	`path` text NOT NULL,
	`backend_id` text NOT NULL,
	`status` text NOT NULL,
	`reserved_units` integer NOT NULL,
	`charged_units` integer,
	`reported_input_tokens` integer,
	`reported_output_tokens` integer,
	`created_at` integer NOT NULL,
	`settled_at` integer
);
--> statement-breakpoint
CREATE INDEX `plugin_model_calls_day_idx` ON `plugin_model_calls` (`owner_id`,`plugin_id`,`day`);--> statement-breakpoint
CREATE TABLE `plugin_model_grants` (
	`owner_id` text NOT NULL,
	`plugin_id` text NOT NULL,
	`backend_id` text NOT NULL,
	`model_id` text NOT NULL,
	`daily_output_tokens` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner_id`, `plugin_id`)
);
