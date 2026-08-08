PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- Pair data is staging only. Plugin init resolves it through CoreServices.projects before dropping
-- these tables; the live HTTP tables have no repository-pair columns after this migration.
CREATE TABLE `legacy_http_requests_rekey` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_owner` text,
	`repo_name` text
);--> statement-breakpoint
INSERT INTO `legacy_http_requests_rekey` (`id`, `repo_owner`, `repo_name`)
SELECT `id`, `repo_owner`, `repo_name`
FROM `http_requests`
WHERE `project_id` IS NULL AND (`repo_owner` IS NOT NULL OR `repo_name` IS NOT NULL);--> statement-breakpoint
CREATE TABLE `legacy_http_variables_rekey` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_owner` text,
	`repo_name` text
);--> statement-breakpoint
INSERT INTO `legacy_http_variables_rekey` (`id`, `repo_owner`, `repo_name`)
SELECT `id`, `repo_owner`, `repo_name`
FROM `http_variables`
WHERE `project_id` IS NULL AND (`repo_owner` IS NOT NULL OR `repo_name` IS NOT NULL);--> statement-breakpoint
CREATE TABLE `__new_http_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT '__legacy_unscoped__' NOT NULL,
	`project_id` text,
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
);--> statement-breakpoint
INSERT INTO `__new_http_requests` (`id`, `user_id`, `project_id`, `folder`, `task_id`, `name`, `method`, `url`, `headers`, `body_mode`, `body`, `auth`, `vars`, `encrypted`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `project_id`, `folder`, `task_id`, `name`, `method`, `url`, `headers`, `body_mode`, `body`, `auth`, `vars`, `encrypted`, `created_at`, `updated_at`
FROM `http_requests`;--> statement-breakpoint
DROP TABLE `http_requests`;--> statement-breakpoint
ALTER TABLE `__new_http_requests` RENAME TO `http_requests`;--> statement-breakpoint
CREATE TABLE `__new_http_variables` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text DEFAULT '__legacy_unscoped__' NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`encrypted` integer DEFAULT false NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_http_variables` (`id`, `user_id`, `project_id`, `name`, `kind`, `value`, `encrypted`, `enabled`, `created_at`, `updated_at`)
SELECT `id`, `user_id`, `project_id`, `name`, `kind`, `value`, `encrypted`, `enabled`, `created_at`, `updated_at`
FROM `http_variables`;--> statement-breakpoint
DROP TABLE `http_variables`;--> statement-breakpoint
ALTER TABLE `__new_http_variables` RENAME TO `http_variables`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `http_requests_user_project_folder_idx` ON `http_requests` (`user_id`, `project_id`, `folder`);--> statement-breakpoint
CREATE INDEX `http_requests_user_task_idx` ON `http_requests` (`user_id`, `task_id`);--> statement-breakpoint
-- This is the last statement on purpose: the staging tables are NOT dropped here. The migration cannot
-- query core.sqlite, so the HTTP plugin's awaited init resolves each pair through
-- CoreServices.projects and drops them only after resolvable rows have been stamped with project_id.
-- Unresolved rows are intentionally inert.
-- Keep the comment inside this statement's chunk: a chunk holding only comments is not a statement,
-- and drizzle's migrator hands every chunk to better-sqlite3, which rejects it.
CREATE UNIQUE INDEX `http_variables_user_project_name_idx` ON `http_variables` (`user_id`, `project_id`, `name`);
