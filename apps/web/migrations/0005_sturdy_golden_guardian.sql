CREATE TABLE `workspace_projects` (
	`workspace_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `integration_id`, `external_id`)
);
--> statement-breakpoint
DROP TABLE `workspace_linear_projects`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`access_token` text NOT NULL,
	`meta` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
-- ponytail: INSERT…SELECT copy dropped — old rows lack id/label (new NOT NULL cols), can't backfill; disposable.
DROP TABLE `integrations`;--> statement-breakpoint
ALTER TABLE `__new_integrations` RENAME TO `integrations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_issues` (
	`user_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`provider` text NOT NULL,
	`identifier` text NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `integration_id`, `identifier`)
);
--> statement-breakpoint
-- ponytail: INSERT…SELECT copy dropped — old rows lack integration_id (new NOT NULL col); cache re-fetches.
DROP TABLE `issues`;--> statement-breakpoint
ALTER TABLE `__new_issues` RENAME TO `issues`;--> statement-breakpoint
CREATE TABLE `__new_task_links` (
	`task_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`provider` text NOT NULL,
	`identifier` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `integration_id`, `identifier`)
);
--> statement-breakpoint
-- ponytail: INSERT…SELECT copy dropped — old rows lack integration_id (new NOT NULL col); links re-seed on promote.
DROP TABLE `task_links`;--> statement-breakpoint
ALTER TABLE `__new_task_links` RENAME TO `task_links`;