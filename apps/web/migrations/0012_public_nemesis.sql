CREATE TABLE `review_requests` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`login` text NOT NULL,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `login`)
);
