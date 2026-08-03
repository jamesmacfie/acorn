CREATE TABLE `db_saved_queries` (
	`id` text PRIMARY KEY NOT NULL,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`sql` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `db_saved_queries_repo_name_idx` ON `db_saved_queries` (`repo_owner`,`repo_name`,`name`);