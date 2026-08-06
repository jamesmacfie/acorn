CREATE TABLE `checks` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`status` text,
	`url` text,
	`run_id` integer,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `name`)
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`id` text NOT NULL,
	`author` text,
	`body` text,
	`created_at` integer,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `id`)
);
--> statement-breakpoint
CREATE TABLE `pinned_repos` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `repo_id`)
);
--> statement-breakpoint
CREATE TABLE `pr_commits` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`sha` text NOT NULL,
	`message` text NOT NULL,
	`author` text,
	`author_login` text,
	`committed_at` integer,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `sha`)
);
--> statement-breakpoint
CREATE TABLE `pr_files` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`path` text NOT NULL,
	`status` text,
	`additions` integer,
	`deletions` integer,
	`sha` text,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `path`)
);
--> statement-breakpoint
CREATE TABLE `pr_labels` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`color` text,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `name`)
);
--> statement-breakpoint
CREATE TABLE `pull_requests` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`node_id` text,
	`state` text NOT NULL,
	`draft` integer DEFAULT false NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`head_sha` text,
	`head_ref` text,
	`base_ref` text,
	`author` text,
	`updated_at` integer,
	`mergeable` text,
	`merge_state_status` text,
	`auto_merge_enabled` integer DEFAULT false NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `repo_id`, `number`)
);
--> statement-breakpoint
CREATE INDEX `pull_requests_user_repo_state_updated_idx` ON `pull_requests` (`user_id`,`repo_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `repos` (
	`user_id` text NOT NULL,
	`id` integer NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`private` integer DEFAULT false NOT NULL,
	`default_branch` text,
	`pushed_at` integer,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `id`)
);
--> statement-breakpoint
CREATE TABLE `review_requests` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`login` text NOT NULL,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `login`)
);
--> statement-breakpoint
CREATE TABLE `review_threads` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`thread_id` text NOT NULL,
	`id` text NOT NULL,
	`database_id` integer,
	`path` text,
	`line` integer,
	`side` text,
	`resolved` integer DEFAULT false NOT NULL,
	`author` text,
	`body` text,
	`created_at` integer,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `id`)
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`id` text NOT NULL,
	`author` text,
	`state` text,
	`body` text,
	`submitted_at` integer,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `id`)
);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`user_id` text NOT NULL,
	`resource` text NOT NULL,
	`etag` text,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `resource`)
);
--> statement-breakpoint
CREATE TABLE `viewed_files` (
	`user_id` text NOT NULL,
	`repo_id` integer NOT NULL,
	`number` integer NOT NULL,
	`path` text NOT NULL,
	`viewed_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `repo_id`, `number`, `path`)
);
