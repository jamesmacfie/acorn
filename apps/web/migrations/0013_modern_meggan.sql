CREATE TABLE `integrations` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`access_token` text NOT NULL,
	`meta` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `provider`)
);
--> statement-breakpoint
CREATE TABLE `issues` (
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`identifier` text NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `provider`, `identifier`)
);
