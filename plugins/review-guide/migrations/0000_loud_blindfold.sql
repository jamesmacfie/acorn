CREATE TABLE `review_guides` (
	`task_id` text NOT NULL,
	`base_sha` text NOT NULL,
	`head_sha` text NOT NULL,
	`base_ref` text NOT NULL,
	`profile_id` text NOT NULL,
	`status` text NOT NULL,
	`guide` text,
	`error` text,
	`session_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`task_id`, `base_sha`, `head_sha`)
);
