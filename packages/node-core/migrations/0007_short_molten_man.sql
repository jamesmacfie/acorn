CREATE TABLE `dashboard_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`content` text NOT NULL,
	`draft_revision` integer NOT NULL,
	`base_published_revision` integer,
	`published_revision` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `dashboard_revisions` (
	`dashboard_id` text NOT NULL,
	`revision` integer NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`content` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`dashboard_id`, `revision`)
);
--> statement-breakpoint
CREATE TABLE `query_consumers` (
	`query_id` text NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`plugin_id` text NOT NULL,
	`kind` text NOT NULL,
	`consumer_id` text NOT NULL,
	`content` text NOT NULL,
	PRIMARY KEY(`query_id`, `plugin_id`, `kind`, `consumer_id`)
);
--> statement-breakpoint
CREATE TABLE `query_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`content` text NOT NULL,
	`draft_revision` integer NOT NULL,
	`base_published_revision` integer,
	`published_revision` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `query_publication_holds` (
	`query_id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`plan` text NOT NULL,
	`revision` integer,
	`released` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE `query_revisions` (
	`query_id` text NOT NULL,
	`revision` integer NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`content` text NOT NULL,
	`digest` text NOT NULL,
	`source_revision` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`query_id`, `revision`)
);
