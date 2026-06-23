CREATE TABLE `pr_labels` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`color` text,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `name`)
);
