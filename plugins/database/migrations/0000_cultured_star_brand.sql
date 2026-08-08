CREATE TABLE `db_saved_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`notes` text,
	`sql` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_saved_queries_project_name_idx` ON `db_saved_queries` (`project_id`,`name`);