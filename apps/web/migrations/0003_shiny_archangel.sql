CREATE TABLE `checks` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`status` text,
	`url` text,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `name`)
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`id` text NOT NULL,
	`author` text,
	`body` text,
	`created_at` integer,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `id`)
);
--> statement-breakpoint
CREATE TABLE `pr_files` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`path` text NOT NULL,
	`status` text,
	`additions` integer,
	`deletions` integer,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `path`)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`id` text NOT NULL,
	`author` text,
	`state` text,
	`body` text,
	`submitted_at` integer,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `id`)
);
