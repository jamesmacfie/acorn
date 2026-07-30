CREATE TABLE `agent_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`turn_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`media_type` text,
	`storage_key` text,
	`byte_size` integer,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_artifacts_session_created_idx` ON `agent_artifacts` (`session_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_artifacts_turn_idx` ON `agent_artifacts` (`turn_id`);--> statement-breakpoint
CREATE TABLE `agent_attachment_refs` (
	`attachment_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`attachment_id`, `turn_id`)
);
--> statement-breakpoint
CREATE INDEX `agent_attachment_refs_turn_position_idx` ON `agent_attachment_refs` (`turn_id`,`position`);--> statement-breakpoint
CREATE TABLE `agent_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`storage_key` text NOT NULL,
	`content_hash` text NOT NULL,
	`filename` text NOT NULL,
	`media_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`text_encoding` text,
	`created_at` integer NOT NULL,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_attachments_task_hash_idx` ON `agent_attachments` (`task_id`,`content_hash`);--> statement-breakpoint
CREATE INDEX `agent_attachments_storage_idx` ON `agent_attachments` (`storage_key`);--> statement-breakpoint
CREATE TABLE `agent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`turn_id` text,
	`seq` integer NOT NULL,
	`schema_version` integer NOT NULL,
	`event_json` text NOT NULL,
	`search_text` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_events_session_seq_idx` ON `agent_events` (`session_id`,`seq`);--> statement-breakpoint
CREATE INDEX `agent_events_turn_seq_idx` ON `agent_events` (`turn_id`,`seq`);--> statement-breakpoint
CREATE INDEX `agent_events_created_idx` ON `agent_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `agent_operations` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`command` text NOT NULL,
	`resource_id` text,
	`result_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_operations_created_idx` ON `agent_operations` (`created_at`);--> statement-breakpoint
CREATE TABLE `agent_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`turn_id` text,
	`provider_request_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`title` text NOT NULL,
	`detail` text,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`resolution_json` text,
	`resolution_idempotency_key` text,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`resolved_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_requests_session_provider_idx` ON `agent_requests` (`session_id`,`provider_request_id`);--> statement-breakpoint
CREATE INDEX `agent_requests_status_created_idx` ON `agent_requests` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`profile_id` text NOT NULL,
	`kind` text NOT NULL,
	`driver_kind` text NOT NULL,
	`driver_version` text NOT NULL,
	`provider_session_ref` text,
	`controller` text DEFAULT 'acorn' NOT NULL,
	`runtime_state` text NOT NULL,
	`attention` text DEFAULT 'none' NOT NULL,
	`status_authority` text NOT NULL,
	`title` text NOT NULL,
	`model` text,
	`config_json` text DEFAULT '{}' NOT NULL,
	`parent_session_id` text,
	`parent_turn_id` text,
	`last_event_seq` integer DEFAULT 0 NOT NULL,
	`last_read_seq` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `agent_sessions_task_updated_idx` ON `agent_sessions` (`task_id`,`updated_at`);--> statement-breakpoint
CREATE INDEX `agent_sessions_attention_updated_idx` ON `agent_sessions` (`attention`,`updated_at`);--> statement-breakpoint
CREATE INDEX `agent_sessions_provider_ref_idx` ON `agent_sessions` (`provider_id`,`provider_session_ref`);--> statement-breakpoint
CREATE INDEX `agent_sessions_parent_idx` ON `agent_sessions` (`parent_session_id`);--> statement-breakpoint
CREATE TABLE `agent_turns` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	`source` text NOT NULL,
	`status` text NOT NULL,
	`input_json` text NOT NULL,
	`effective_policy_json` text DEFAULT '{}' NOT NULL,
	`provider_turn_ref` text,
	`stop_reason` text,
	`usage_json` text,
	`error_json` text,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_turns_session_ordinal_idx` ON `agent_turns` (`session_id`,`ordinal`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_turns_session_idempotency_idx` ON `agent_turns` (`session_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_turns_session_status_idx` ON `agent_turns` (`session_id`,`status`);--> statement-breakpoint
ALTER TABLE `terminal_sessions` ADD `agent_session_id` text;--> statement-breakpoint
CREATE INDEX `terminal_sessions_agent_session_idx` ON `terminal_sessions` (`agent_session_id`);--> statement-breakpoint
ALTER TABLE `workflow_steps` ADD `agent_session_id` text;--> statement-breakpoint
CREATE INDEX `workflow_steps_agent_session_idx` ON `workflow_steps` (`agent_session_id`);--> statement-breakpoint
CREATE VIRTUAL TABLE `agent_events_fts` USING fts5(
	`event_id` UNINDEXED,
	`session_id` UNINDEXED,
	`content`,
	tokenize = 'porter unicode61'
);--> statement-breakpoint
CREATE TRIGGER `agent_events_fts_insert` AFTER INSERT ON `agent_events`
WHEN NEW.`search_text` IS NOT NULL
BEGIN
	INSERT INTO `agent_events_fts` (`event_id`, `session_id`, `content`)
	VALUES (NEW.`id`, NEW.`session_id`, NEW.`search_text`);
END;--> statement-breakpoint
CREATE TRIGGER `agent_events_fts_update` AFTER UPDATE OF `search_text` ON `agent_events`
BEGIN
	DELETE FROM `agent_events_fts` WHERE `event_id` = OLD.`id`;
	INSERT INTO `agent_events_fts` (`event_id`, `session_id`, `content`)
	SELECT NEW.`id`, NEW.`session_id`, NEW.`search_text`
	WHERE NEW.`search_text` IS NOT NULL;
END;--> statement-breakpoint
CREATE TRIGGER `agent_events_fts_delete` AFTER DELETE ON `agent_events`
BEGIN
	DELETE FROM `agent_events_fts` WHERE `event_id` = OLD.`id`;
END;
