CREATE TABLE `workflow_trigger_records` (
	`trigger_id` text NOT NULL,
	`epoch` text NOT NULL,
	`record_key` text NOT NULL,
	`projection` text NOT NULL,
	`matching` integer NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_occurrence_id` text,
	PRIMARY KEY(`trigger_id`, `epoch`, `record_key`)
);
--> statement-breakpoint
ALTER TABLE `workflow_triggers` ADD `approved_query_json` text;--> statement-breakpoint
ALTER TABLE `workflow_triggers` ADD `boundary_json` text;--> statement-breakpoint
ALTER TABLE `workflow_triggers` ADD `query_fingerprint` text;--> statement-breakpoint
ALTER TABLE `workflow_triggers` ADD `last_check_json` text;