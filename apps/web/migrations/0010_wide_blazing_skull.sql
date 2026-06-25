CREATE TABLE `pr_commits` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`sha` text NOT NULL,
	`message` text NOT NULL,
	`author` text,
	`author_login` text,
	`committed_at` integer,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `sha`)
);
