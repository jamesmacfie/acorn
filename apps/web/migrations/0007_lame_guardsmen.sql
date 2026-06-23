CREATE TABLE `review_threads` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`thread_id` text NOT NULL,
	`id` text NOT NULL,
	`database_id` integer,
	`path` text,
	`line` integer,
	`side` text,
	`resolved` integer DEFAULT false NOT NULL,
	`author` text,
	`body` text,
	`created_at` integer,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `id`)
);
--> statement-breakpoint
ALTER TABLE `pull_requests` ADD `head_sha` text;