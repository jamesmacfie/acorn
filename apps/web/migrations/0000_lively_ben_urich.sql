CREATE TABLE `prefs` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`node_id` text,
	`state` text NOT NULL,
	`draft` integer DEFAULT false NOT NULL,
	`title` text NOT NULL,
	`head_ref` text,
	`base_ref` text,
	`author` text,
	`updated_at` integer,
	`fetched_at` integer NOT NULL,
	`stale_after` integer NOT NULL,
	`etag` text,
	PRIMARY KEY(`repo_id`, `number`)
);
--> statement-breakpoint
CREATE TABLE `repos` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`default_branch` text,
	`pushed_at` integer,
	`fetched_at` integer NOT NULL,
	`stale_after` integer NOT NULL,
	`etag` text
);
