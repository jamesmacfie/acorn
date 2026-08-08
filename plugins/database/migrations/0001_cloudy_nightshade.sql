PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_db_saved_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`repo_owner` text,
	`repo_name` text,
	`name` text NOT NULL,
	`notes` text,
	`sql` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
-- project_id did not exist in 0000; init-time backfill resolves it through CoreServices.projects.
INSERT INTO `__new_db_saved_queries`("id", "repo_owner", "repo_name", "name", "notes", "sql", "created_at", "updated_at") SELECT "id", "repo_owner", "repo_name", "name", "notes", "sql", "created_at", "updated_at" FROM `db_saved_queries`;--> statement-breakpoint
DROP TABLE `db_saved_queries`;--> statement-breakpoint
ALTER TABLE `__new_db_saved_queries` RENAME TO `db_saved_queries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `db_saved_queries_project_name_idx` ON `db_saved_queries` (`project_id`,`name`);
