CREATE TABLE `repo_paths` (
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`github_repo_id` integer,
	`path` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `repo`)
);
