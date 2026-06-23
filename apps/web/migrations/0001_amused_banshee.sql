PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_repos` (
	`user_id` text NOT NULL,
	`id` integer NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`default_branch` text,
	`pushed_at` integer,
	`fetched_at` integer NOT NULL,
	`stale_after` integer NOT NULL,
	`etag` text,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
-- repos was never populated (no user_id existed to copy); recreate empty. ponytail.
DROP TABLE `repos`;--> statement-breakpoint
ALTER TABLE `__new_repos` RENAME TO `repos`;--> statement-breakpoint
PRAGMA foreign_keys=ON;