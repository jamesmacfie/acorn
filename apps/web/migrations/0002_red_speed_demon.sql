CREATE TABLE `sync_state` (
	`user_id` text NOT NULL,
	`resource` text NOT NULL,
	`etag` text,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `resource`)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_pull_requests` (
	`user_id` text NOT NULL,
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
	PRIMARY KEY(`user_id`, `repo_id`, `number`)
);
--> statement-breakpoint
-- pull_requests was never populated (no user_id existed to copy); recreate empty. ponytail.
DROP TABLE `pull_requests`;--> statement-breakpoint
ALTER TABLE `__new_pull_requests` RENAME TO `pull_requests`;--> statement-breakpoint
PRAGMA foreign_keys=ON;