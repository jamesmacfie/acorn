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
CREATE TABLE `dashboard_measure_samples` (
	`panel_id` text NOT NULL,
	`signature` text NOT NULL,
	`bucket` integer NOT NULL,
	`value` real NOT NULL,
	`recorded_at` integer NOT NULL,
	PRIMARY KEY(`panel_id`, `bucket`)
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
	`name` text,
	`encrypted_credentials` text NOT NULL,
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
	`color` text,
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
--> statement-breakpoint
CREATE TABLE `schedule_runs` (
	`key` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text NOT NULL,
	`detail` text,
	PRIMARY KEY(`key`, `started_at`)
);
--> statement-breakpoint
CREATE TABLE `schedule_state` (
	`key` text PRIMARY KEY NOT NULL,
	`enabled_override` integer,
	`cadence_override` text,
	`next_run_at` integer NOT NULL,
	`last_run_at` integer,
	`last_status` text,
	`last_error` text,
	`backoff_until` integer
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
CREATE TABLE `task_pulls` (
	`task_id` text NOT NULL,
	`repo_owner` text NOT NULL,
	`repo_name` text NOT NULL,
	`pull_number` integer NOT NULL,
	`role` text NOT NULL,
	`provenance` text NOT NULL,
	`session_id` text NOT NULL,
	`request_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `repo_owner`, `repo_name`, `pull_number`)
);
--> statement-breakpoint
CREATE INDEX `task_pulls_repo_pull_idx` ON `task_pulls` (`repo_owner`,`repo_name`,`pull_number`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_pulls_one_primary_idx` ON `task_pulls` (`task_id`) WHERE "task_pulls"."role" = 'primary';--> statement-breakpoint
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
CREATE TABLE `user_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`cadence` text NOT NULL,
	`risk` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workspace_external_projects` (
	`workspace_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`external_id` text NOT NULL,
	`project_id` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`workspace_id`, `integration_id`, `external_id`, `project_id`)
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`is_default` integer DEFAULT false NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
