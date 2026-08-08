PRAGMA foreign_keys=OFF;--> statement-breakpoint
-- Pair data is staging only. Plugin init resolves it through CoreServices.projects before dropping
-- this table; the live saved-query table has no repository-pair columns after this migration.
CREATE TABLE `legacy_db_saved_queries_rekey` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_owner` text,
	`repo_name` text
);--> statement-breakpoint
INSERT INTO `legacy_db_saved_queries_rekey` (`id`, `repo_owner`, `repo_name`)
SELECT `id`, `repo_owner`, `repo_name`
FROM `db_saved_queries`
WHERE `project_id` IS NULL AND (`repo_owner` IS NOT NULL OR `repo_name` IS NOT NULL);--> statement-breakpoint
CREATE TABLE `__new_db_saved_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`notes` text,
	`sql` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
INSERT INTO `__new_db_saved_queries` (`id`, `project_id`, `name`, `notes`, `sql`, `created_at`, `updated_at`)
SELECT `id`, `project_id`, `name`, `notes`, `sql`, `created_at`, `updated_at`
FROM `db_saved_queries`;--> statement-breakpoint
DROP TABLE `db_saved_queries`;--> statement-breakpoint
ALTER TABLE `__new_db_saved_queries` RENAME TO `db_saved_queries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
-- This is the last statement on purpose: the staging table is NOT dropped here. The migration cannot
-- query core.sqlite, so the database plugin's awaited init resolves each pair through
-- CoreServices.projects and drops the staging table only after resolvable rows have been stamped
-- with project_id. Unresolved rows are intentionally inert.
-- Keep the comment inside this statement's chunk: a chunk holding only comments is not a statement,
-- and drizzle's migrator hands every chunk to better-sqlite3, which rejects it.
CREATE UNIQUE INDEX `db_saved_queries_project_name_idx` ON `db_saved_queries` (`project_id`, `name`);
