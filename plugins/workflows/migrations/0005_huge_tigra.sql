CREATE TABLE `workflow_processing_boundaries` (
	`scope_key` text PRIMARY KEY NOT NULL,
	`query_fingerprint` text NOT NULL,
	`boundary_json` text NOT NULL,
	`selection_id` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_processing_scopes` (
	`run_id` text PRIMARY KEY NOT NULL,
	`scope_id` text NOT NULL,
	`epoch` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_record_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`state_id` text NOT NULL,
	`selection_id` text NOT NULL,
	`dispatch_id` text NOT NULL,
	`previous_attempt_id` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_record_attempts_dispatch_id_unique` ON `workflow_record_attempts` (`dispatch_id`);--> statement-breakpoint
CREATE INDEX `workflow_record_attempts_history_idx` ON `workflow_record_attempts` (`state_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workflow_record_states` (
	`id` text PRIMARY KEY NOT NULL,
	`scope_key` text NOT NULL,
	`record_key` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`fields_json` text NOT NULL,
	`projection` text NOT NULL,
	`attempt_id` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_record_states_scope_key_uq` ON `workflow_record_states` (`scope_key`,`record_key`);--> statement-breakpoint
CREATE TABLE `workflow_selected_records` (
	`id` text PRIMARY KEY NOT NULL,
	`selection_id` text NOT NULL,
	`position` integer NOT NULL,
	`record_key` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`decision` text NOT NULL,
	`attempt_id` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_selected_records_selection_key_uq` ON `workflow_selected_records` (`selection_id`,`record_key`);--> statement-breakpoint
CREATE INDEX `workflow_selected_records_page_idx` ON `workflow_selected_records` (`selection_id`,`position`);--> statement-breakpoint
CREATE TABLE `workflow_selections` (
	`id` text PRIMARY KEY NOT NULL,
	`invocation_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`scope_key` text NOT NULL,
	`snapshot_json` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_selections_invocation_key_unique` ON `workflow_selections` (`invocation_key`);--> statement-breakpoint
CREATE INDEX `workflow_selections_run_idx` ON `workflow_selections` (`run_id`,`created_at`);