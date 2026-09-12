CREATE TABLE `finding_preparation_inputs` (
	`job_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`ordinal` integer NOT NULL,
	PRIMARY KEY(`job_id`, `observation_id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `finding_preparation_inputs_ordinal_unique` ON `finding_preparation_inputs` (`job_id`,`ordinal`);