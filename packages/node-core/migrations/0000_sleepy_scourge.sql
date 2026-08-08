CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`at` integer NOT NULL,
	`actor` text NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`subject` text,
	`details` text
);
--> statement-breakpoint
CREATE INDEX `audit_at_idx` ON `audit` (`at`);--> statement-breakpoint
CREATE TABLE `config_acks` (
	`project_id` text,
	`hash` text NOT NULL,
	`snapshot` text NOT NULL,
	`acked_at` integer NOT NULL,
	PRIMARY KEY(`project_id`, `hash`)
);
--> statement-breakpoint
CREATE INDEX `config_acks_project_acked_idx` ON `config_acks` (`project_id`,`acked_at`);--> statement-breakpoint
CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`secret_hash` blob NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `devices_revoked_idx` ON `devices` (`revoked_at`);--> statement-breakpoint
CREATE TABLE `idempotency` (
	`device_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer NOT NULL,
	`response_body` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`device_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idempotency_expiry_idx` ON `idempotency` (`expires_at`);--> statement-breakpoint
CREATE TABLE `integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`access_token` text NOT NULL,
	`auth_kind` text DEFAULT 'api-key' NOT NULL,
	`account` text,
	`scopes` text DEFAULT '[]' NOT NULL,
	`capabilities` text DEFAULT '{}' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_validated_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `issue_resources` (
	`user_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`provider` text NOT NULL,
	`issue_identifier` text NOT NULL,
	`resource` text NOT NULL,
	`identifier` text NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `integration_id`, `issue_identifier`, `resource`, `identifier`)
);
--> statement-breakpoint
CREATE TABLE `issues` (
	`user_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`provider` text NOT NULL,
	`identifier` text NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `integration_id`, `identifier`)
);
--> statement-breakpoint
CREATE TABLE `prefs` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`value` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text,
	`workspace_id` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`hidden` integer DEFAULT false NOT NULL,
	`vcs` text,
	`default_branch` text,
	`remote_url` text,
	`github_owner` text,
	`github_name` text,
	`github_repo_id` integer,
	`run_targets` text,
	`editor_command` text,
	`setup_script` text,
	`setup_script_trigger` text,
	`dev_script` text,
	`dev_restart_script` text,
	`teardown_script` text,
	`db_url_script` text,
	`db_schema_mode` text,
	`db_schema_value` text,
	`db_schema_notes` text,
	`preview_mode` text,
	`preview_value` text,
	`browser_rules` text,
	`branch_prefix` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `projects_workspace_idx` ON `projects` (`workspace_id`);--> statement-breakpoint
CREATE INDEX `projects_github_idx` ON `projects` (`github_owner`,`github_name`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`user_id` text NOT NULL,
	`resource` text NOT NULL,
	`etag` text,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `resource`)
);
--> statement-breakpoint
CREATE TABLE `task_links` (
	`task_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`provider` text NOT NULL,
	`identifier` text NOT NULL,
	`ref_json` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `integration_id`, `identifier`)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`icon` text,
	`origin` text NOT NULL,
	`project_id` text NOT NULL,
	`branch` text,
	`worktree_path` text,
	`pull_number` integer,
	`status` text NOT NULL,
	`parent_id` text,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer
);
--> statement-breakpoint
CREATE TABLE `workspace_external_projects` (
	`workspace_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`external_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `integration_id`, `external_id`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`icon` text,
	`color` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
