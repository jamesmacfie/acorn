CREATE TABLE `api_idempotency` (
	`token_id` text NOT NULL,
	`operation_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer NOT NULL,
	`response_body` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`token_id`, `operation_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `api_idempotency_expiry_idx` ON `api_idempotency` (`expires_at`);--> statement-breakpoint
CREATE TABLE `api_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`token_prefix` text NOT NULL,
	`secret_hash` blob NOT NULL,
	`can_write` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`expires_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `api_tokens_user_created_idx` ON `api_tokens` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `api_tokens_active_idx` ON `api_tokens` (`id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `command_executions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`status` text NOT NULL,
	`stdout` text DEFAULT '' NOT NULL,
	`stderr` text DEFAULT '' NOT NULL,
	`output_truncated` integer DEFAULT false NOT NULL,
	`exit_code` integer,
	`signal` text,
	`timeout_ms` integer NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `command_executions_task_created_idx` ON `command_executions` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `command_executions_status_idx` ON `command_executions` (`status`);--> statement-breakpoint
CREATE TABLE `oauth_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`encrypted_access_token` text NOT NULL,
	`login` text NOT NULL,
	`name` text NOT NULL,
	`avatar` text NOT NULL,
	`scopes_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
