CREATE TABLE `pinned_repos` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `repo_id`)
);
--> statement-breakpoint
CREATE TABLE `viewed_files` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`path` text NOT NULL,
	`viewed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `path`)
);
