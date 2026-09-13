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
CREATE INDEX `workflow_turn_admissions_state_idx` ON `workflow_turn_admissions` (`state`);--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `effective_tools_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `effective_budget_json` text DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `requires_repo_trust` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `workflow_runs` ADD `deadline_at` integer;--> statement-breakpoint
UPDATE `workflow_runs`
SET `effective_tools_json` = COALESCE(json_extract(`def_json`, '$.tools'), '{}'),
    `effective_budget_json` = COALESCE(json_extract(`def_json`, '$.budget'), '{}'),
    `deadline_at` = CASE
      WHEN json_type(`def_json`, '$.budget.maxWallTimeMs') IN ('integer', 'real')
      THEN `created_at` + CAST(json_extract(`def_json`, '$.budget.maxWallTimeMs') AS integer)
      ELSE NULL
    END;
