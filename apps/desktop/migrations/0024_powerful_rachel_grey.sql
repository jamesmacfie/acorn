CREATE TABLE `issue_resources` (
	`user_id` text NOT NULL,
	`integration_id` text NOT NULL,
	`provider` text NOT NULL,
	`issue_identifier` text NOT NULL,
	`resource` text NOT NULL,
	`identifier` text NOT NULL,
	`data` text NOT NULL,
	`fetched_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `integration_id`, `issue_identifier`, `resource`, `identifier`)
);
