PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_http_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT '__legacy_unscoped__' NOT NULL,
	`project_id` text,
	`repo_owner` text,
	`repo_name` text,
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
-- project_id did not exist in 0000; init-time backfill resolves it through CoreServices.projects.
INSERT INTO `__new_http_requests`("id", "user_id", "repo_owner", "repo_name", "folder", "task_id", "name", "method", "url", "headers", "body_mode", "body", "auth", "vars", "encrypted", "created_at", "updated_at") SELECT "id", "user_id", "repo_owner", "repo_name", "folder", "task_id", "name", "method", "url", "headers", "body_mode", "body", "auth", "vars", "encrypted", "created_at", "updated_at" FROM `http_requests`;--> statement-breakpoint
DROP TABLE `http_requests`;--> statement-breakpoint
ALTER TABLE `__new_http_requests` RENAME TO `http_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `http_requests_user_project_folder_idx` ON `http_requests` (`user_id`,`project_id`,`folder`);--> statement-breakpoint
CREATE INDEX `http_requests_user_task_idx` ON `http_requests` (`user_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `__new_http_variables` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT '__legacy_unscoped__' NOT NULL,
	`project_id` text,
	`repo_owner` text,
	`repo_name` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`encrypted` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_http_variables`("id", "user_id", "repo_owner", "repo_name", "name", "kind", "value", "encrypted", "enabled", "created_at", "updated_at") SELECT "id", "user_id", "repo_owner", "repo_name", "name", "kind", "value", "encrypted", "enabled", "created_at", "updated_at" FROM `http_variables`;--> statement-breakpoint
DROP TABLE `http_variables`;--> statement-breakpoint
ALTER TABLE `__new_http_variables` RENAME TO `http_variables`;--> statement-breakpoint
CREATE UNIQUE INDEX `http_variables_user_project_name_idx` ON `http_variables` (`user_id`,`project_id`,`name`);
