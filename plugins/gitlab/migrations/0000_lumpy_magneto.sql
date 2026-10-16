CREATE TABLE `jobs` (
	`connection_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`iid` integer NOT NULL,
	`job_id` integer NOT NULL,
	`name` text NOT NULL,
	`stage` text,
	`status` text,
	`url` text,
	`pipeline_sha` text,
	`position` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `project_id`, `iid`, `job_id`)
);
--> statement-breakpoint
CREATE TABLE `merge_requests` (
	`connection_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`iid` integer NOT NULL,
	`state` text NOT NULL,
	`draft` integer DEFAULT false NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`head_ref` text,
	`base_ref` text,
	`head_sha` text,
	`base_sha` text,
	`start_sha` text,
	`author` text,
	`author_avatar` text,
	`updated_at` integer,
	`conflicting` integer DEFAULT false NOT NULL,
	`pipeline_status` text,
	`files_capped` integer DEFAULT false NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `project_id`, `iid`)
);
--> statement-breakpoint
CREATE INDEX `merge_requests_connection_project_state_updated_idx` ON `merge_requests` (`connection_id`,`project_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `mr_commits` (
	`connection_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`iid` integer NOT NULL,
	`sha` text NOT NULL,
	`message` text NOT NULL,
	`author` text,
	`author_login` text,
	`committed_at` integer,
	`position` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `project_id`, `iid`, `sha`)
);
--> statement-breakpoint
CREATE TABLE `mr_files` (
	`connection_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`iid` integer NOT NULL,
	`path` text NOT NULL,
	`status` text,
	`additions` integer,
	`deletions` integer,
	`position` integer NOT NULL,
	`patch_state` text NOT NULL,
	`patch_key` text,
	PRIMARY KEY(`connection_id`, `project_id`, `iid`, `path`)
);
--> statement-breakpoint
CREATE TABLE `mr_labels` (
	`connection_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`iid` integer NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`position` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `project_id`, `iid`, `name`)
);
--> statement-breakpoint
CREATE TABLE `mr_people` (
	`connection_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`iid` integer NOT NULL,
	`role` text NOT NULL,
	`login` text NOT NULL,
	`avatar_url` text,
	`at` integer,
	`position` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `project_id`, `iid`, `role`, `login`)
);
--> statement-breakpoint
CREATE TABLE `notes` (
	`connection_id` text NOT NULL,
	`project_id` integer NOT NULL,
	`iid` integer NOT NULL,
	`id` integer NOT NULL,
	`discussion_id` text NOT NULL,
	`on_diff` integer DEFAULT false NOT NULL,
	`path` text,
	`line` integer,
	`side` text,
	`outdated` integer DEFAULT false NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`author` text,
	`author_avatar` text,
	`author_is_bot` integer DEFAULT false NOT NULL,
	`body` text,
	`created_at` integer,
	`position` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `project_id`, `iid`, `id`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`connection_id` text NOT NULL,
	`id` integer NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`default_branch` text,
	`private` integer DEFAULT false NOT NULL,
	`last_activity_at` integer,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`connection_id` text NOT NULL,
	`resource` text NOT NULL,
	`revision` text,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `resource`)
);
