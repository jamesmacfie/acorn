CREATE TABLE `http_requests` (
	`id` text PRIMARY KEY NOT NULL,
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
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `http_requests_repo_folder_idx` ON `http_requests` (`repo_owner`,`repo_name`,`folder`);--> statement-breakpoint
CREATE INDEX `http_requests_task_idx` ON `http_requests` (`task_id`);--> statement-breakpoint
CREATE TABLE `http_variables` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `http_variables_repo_name_idx` ON `http_variables` (`repo_owner`,`repo_name`,`name`);