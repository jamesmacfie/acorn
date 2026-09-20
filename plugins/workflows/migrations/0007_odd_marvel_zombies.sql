CREATE TABLE `workflow_file_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`content_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_file_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`content_json` text NOT NULL
);
