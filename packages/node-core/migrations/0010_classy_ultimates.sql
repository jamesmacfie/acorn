CREATE TABLE `review_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`path` text NOT NULL,
	`side` text NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`snippet` text,
	`body` text NOT NULL,
	`sent_at` integer,
	`created_at` integer NOT NULL
);
