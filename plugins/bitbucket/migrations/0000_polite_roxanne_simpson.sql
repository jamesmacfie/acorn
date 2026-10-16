CREATE TABLE `comments` (
	`connection_id` text NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`id` integer NOT NULL,
	`thread_id` integer NOT NULL,
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
	PRIMARY KEY(`connection_id`, `repo`, `number`, `id`)
);
--> statement-breakpoint
CREATE TABLE `commits` (
	`connection_id` text NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`sha` text NOT NULL,
	`message` text NOT NULL,
	`author` text,
	`author_login` text,
	`committed_at` integer,
	`position` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `repo`, `number`, `sha`)
);
--> statement-breakpoint
CREATE TABLE `participants` (
	`connection_id` text NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`login` text NOT NULL,
	`uuid` text NOT NULL,
	`avatar_url` text,
	`reviewer` integer DEFAULT false NOT NULL,
	`state` text,
	`at` integer,
	`position` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `repo`, `number`, `login`)
);
--> statement-breakpoint
CREATE TABLE `pr_files` (
	`connection_id` text NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`path` text NOT NULL,
	`status` text,
	`additions` integer,
	`deletions` integer,
	`position` integer NOT NULL,
	`patch_state` text NOT NULL,
	`patch_key` text,
	PRIMARY KEY(`connection_id`, `repo`, `number`, `path`)
);
--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`connection_id` text NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`state` text NOT NULL,
	`draft` integer DEFAULT false NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`head_ref` text,
	`base_ref` text,
	`head_sha` text,
	`base_sha` text,
	`source_repo` text,
	`author` text,
	`author_avatar` text,
	`updated_at` integer,
	`files_capped` integer DEFAULT false NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `repo`, `number`)
);
--> statement-breakpoint
CREATE INDEX `pull_requests_connection_repo_state_updated_idx` ON `pull_requests` (`connection_id`,`repo`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `repositories` (
	`connection_id` text NOT NULL,
	`repo` text NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`default_branch` text,
	`private` integer DEFAULT true NOT NULL,
	`updated_at` integer,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `repo`)
);
--> statement-breakpoint
CREATE TABLE `statuses` (
	`connection_id` text NOT NULL,
	`repo` text NOT NULL,
	`number` integer NOT NULL,
	`key` text NOT NULL,
	`commit_sha` text NOT NULL,
	`name` text NOT NULL,
	`status` text,
	`url` text,
	`position` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `repo`, `number`, `key`, `commit_sha`)
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`connection_id` text NOT NULL,
	`resource` text NOT NULL,
	`revision` text,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`connection_id`, `resource`)
);
