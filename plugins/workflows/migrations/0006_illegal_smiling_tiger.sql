CREATE TABLE `workflow_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`consumer_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_dependencies_target_idx` ON `workflow_dependencies` (`kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `workflow_publications` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`root_id` text NOT NULL,
	`state` text NOT NULL,
	`plan_json` text NOT NULL,
	`landed_json` text DEFAULT '[]' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`definition_id` text NOT NULL,
	`revision` integer NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`def_json` text NOT NULL,
	`digest` text NOT NULL,
	`operation_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_revisions_definition_revision_uq` ON `workflow_revisions` (`definition_id`,`revision`);--> statement-breakpoint
ALTER TABLE `workflow_defs` ADD `published_revision` integer;--> statement-breakpoint
ALTER TABLE `workflow_defs` ADD `base_published_revision` integer;