CREATE TABLE `http_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT '__legacy_unscoped__' NOT NULL,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`folder` text DEFAULT '' NOT NULL,
	`task_id` text,
	`name` text NOT NULL,
	`method` text NOT NULL,
	`url` text NOT NULL,
	`headers` text DEFAULT '[]' NOT NULL,
	`body_mode` text DEFAULT 'none' NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`auth` text DEFAULT '{"mode":"none"}' NOT NULL,
	`vars` text DEFAULT '{}' NOT NULL,
	`encrypted` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `http_requests_user_repo_folder_idx` ON `http_requests` (`user_id`,`repo_owner`,`repo_name`,`folder`);--> statement-breakpoint
CREATE INDEX `http_requests_user_task_idx` ON `http_requests` (`user_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `http_variables` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT '__legacy_unscoped__' NOT NULL,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`encrypted` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `http_variables_user_repo_name_idx` ON `http_variables` (`user_id`,`repo_owner`,`repo_name`,`name`);