CREATE TABLE `task_pulls` (
	`task_id` text NOT NULL,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`pull_number` integer NOT NULL,
	`role` text NOT NULL,
	`provenance` text NOT NULL,
	`session_id` text NOT NULL,
	`request_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `repo_owner`, `repo_name`, `pull_number`)
);
--> statement-breakpoint
CREATE INDEX `task_pulls_repo_pull_idx` ON `task_pulls` (`repo_owner`,`repo_name`,`pull_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_pulls_one_primary_idx` ON `task_pulls` (`task_id`) WHERE "task_pulls"."role" = 'primary';