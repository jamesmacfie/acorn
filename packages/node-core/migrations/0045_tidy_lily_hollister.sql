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
CREATE INDEX `audit_at_idx` ON `audit` (`at`);