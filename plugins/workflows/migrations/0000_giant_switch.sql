CREATE TABLE `workflow_defs` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`project_id` text,
	`name` text NOT NULL,
	`def_json` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`published_revision` integer,
	`base_published_revision` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_defs_workspace_idx` ON `workflow_defs` (`workspace_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `workflow_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`consumer_id` text NOT NULL,
	`kind` text NOT NULL,
	`target_id` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_dependencies_target_idx` ON `workflow_dependencies` (`kind`,`target_id`);--> statement-breakpoint
CREATE TABLE `workflow_dispatches` (
	`id` text PRIMARY KEY NOT NULL,
	`caller_key` text NOT NULL,
	`payload_fingerprint` text NOT NULL,
	`payload_json` text NOT NULL,
	`parent_task_id` text NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`root_run_id` text NOT NULL,
	`parent_run_id` text NOT NULL,
	`parent_step_id` text NOT NULL,
	`item_key` text,
	`state` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_dispatches_caller_key_uq` ON `workflow_dispatches` (`caller_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_dispatches_task_id_uq` ON `workflow_dispatches` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_dispatches_run_id_uq` ON `workflow_dispatches` (`run_id`);--> statement-breakpoint
CREATE INDEX `workflow_dispatches_state_updated_idx` ON `workflow_dispatches` (`state`,`updated_at`);--> statement-breakpoint
CREATE INDEX `workflow_dispatches_root_created_idx` ON `workflow_dispatches` (`root_run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_dispatches_parent_step_idx` ON `workflow_dispatches` (`parent_step_id`);--> statement-breakpoint
CREATE TABLE `workflow_file_drafts` (
	`id` text PRIMARY KEY NOT NULL,
	`revision` integer NOT NULL,
	`content_json` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `workflow_file_operations` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`content_json` text NOT NULL
);
--> statement-breakpoint
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
	`epoch` text NOT NULL,
	`baseline` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
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
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`name` text NOT NULL,
	`status` text NOT NULL,
	`posture` text DEFAULT 'gated' NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`def_json` text NOT NULL,
	`resolved_graph_json` text,
	`root_run_id` text NOT NULL,
	`parent_run_id` text,
	`parent_step_id` text,
	`depth` integer DEFAULT 0 NOT NULL,
	`invocation_key` text,
	`payload_fingerprint` text,
	`effective_tools_json` text DEFAULT '{}' NOT NULL,
	`effective_budget_json` text DEFAULT '{}' NOT NULL,
	`requires_repo_trust` integer DEFAULT false NOT NULL,
	`deadline_at` integer,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_runs_task_created_idx` ON `workflow_runs` (`task_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_runs_status_idx` ON `workflow_runs` (`status`);--> statement-breakpoint
CREATE INDEX `workflow_runs_root_created_idx` ON `workflow_runs` (`root_run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_runs_parent_created_idx` ON `workflow_runs` (`parent_run_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_runs_invocation_key_uq` ON `workflow_runs` (`invocation_key`);--> statement-breakpoint
CREATE TABLE `workflow_schedule_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`generation` integer NOT NULL,
	`kind` text NOT NULL,
	`due_at` integer,
	`request_key` text NOT NULL,
	`payload_fingerprint` text NOT NULL,
	`payload_json` text NOT NULL,
	`task_id` text NOT NULL,
	`run_id` text NOT NULL,
	`state` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_schedule_occurrences_request_uq` ON `workflow_schedule_occurrences` (`schedule_id`,`request_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_schedule_occurrences_due_uq` ON `workflow_schedule_occurrences` (`schedule_id`,`generation`,`due_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_schedule_occurrences_task_uq` ON `workflow_schedule_occurrences` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_schedule_occurrences_run_uq` ON `workflow_schedule_occurrences` (`run_id`);--> statement-breakpoint
CREATE INDEX `workflow_schedule_occurrences_state_idx` ON `workflow_schedule_occurrences` (`schedule_id`,`state`,`updated_at`);--> statement-breakpoint
CREATE TABLE `workflow_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`scheduler_key` text,
	`workspace_id` text NOT NULL,
	`project_id` text NOT NULL,
	`workflow_id` text NOT NULL,
	`inputs_json` text NOT NULL,
	`timezone` text NOT NULL,
	`limits_json` text NOT NULL,
	`loops_json` text DEFAULT '[]' NOT NULL,
	`approved_graph_json` text,
	`approved_graph_digest` text,
	`generation` integer DEFAULT 0 NOT NULL,
	`epoch` text NOT NULL,
	`state` text NOT NULL,
	`first_check` text DEFAULT 'process-current' NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_schedules_scheduler_key_unique` ON `workflow_schedules` (`scheduler_key`);--> statement-breakpoint
CREATE INDEX `workflow_schedules_project_idx` ON `workflow_schedules` (`project_id`,`updated_at`);--> statement-breakpoint
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
CREATE INDEX `workflow_selections_run_idx` ON `workflow_selections` (`run_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `workflow_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`idx` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'agent' NOT NULL,
	`mode` text DEFAULT 'headless' NOT NULL,
	`profile_id` text,
	`model` text,
	`status` text NOT NULL,
	`worktree_path` text,
	`inputs_json` text,
	`result_json` text,
	`structured_json` text,
	`session_id` text,
	`agent_session_id` text,
	`cost_usd` real,
	`iteration` integer DEFAULT 0 NOT NULL,
	`parent_step_id` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workflow_steps_run_idx_idx` ON `workflow_steps` (`run_id`,`idx`);--> statement-breakpoint
CREATE INDEX `workflow_steps_parent_created_idx` ON `workflow_steps` (`parent_step_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_steps_agent_session_idx` ON `workflow_steps` (`agent_session_id`);--> statement-breakpoint
CREATE TABLE `workflow_turn_admissions` (
	`id` text PRIMARY KEY NOT NULL,
	`root_run_id` text NOT NULL,
	`run_id` text NOT NULL,
	`step_id` text NOT NULL,
	`state` text NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`settled_at` integer
);
--> statement-breakpoint
CREATE INDEX `workflow_turn_admissions_root_created_idx` ON `workflow_turn_admissions` (`root_run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_turn_admissions_run_created_idx` ON `workflow_turn_admissions` (`run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_turn_admissions_step_created_idx` ON `workflow_turn_admissions` (`step_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `workflow_turn_admissions_state_idx` ON `workflow_turn_admissions` (`state`);