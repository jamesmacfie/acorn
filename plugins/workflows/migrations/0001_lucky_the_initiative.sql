DROP INDEX `workflow_dispatches_task_id_uq`;--> statement-breakpoint
ALTER TABLE `workflow_dispatches` ADD `task_mode` text DEFAULT 'child' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `workflow_dispatches_child_task_id_uq` ON `workflow_dispatches` (`task_id`) WHERE "workflow_dispatches"."task_mode" = 'child';