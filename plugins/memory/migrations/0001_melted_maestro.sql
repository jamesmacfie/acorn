-- The index is a derived cache over markdown. Dropping it is intentional: old rows cannot be safely
-- assigned to a project without consulting CoreServices, and reconciliation rebuilds current sources.
DELETE FROM `memories`;--> statement-breakpoint
ALTER TABLE `memories` ADD `project_id` text;--> statement-breakpoint
ALTER TABLE `memories` DROP COLUMN `repo`;--> statement-breakpoint
DELETE FROM `memories_fts`;
