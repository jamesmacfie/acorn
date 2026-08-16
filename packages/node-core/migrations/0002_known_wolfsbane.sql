CREATE TABLE `dashboard_measure_samples` (
	`panel_id` text NOT NULL,
	`signature` text NOT NULL,
	`bucket` integer NOT NULL,
	`value` real NOT NULL,
	`recorded_at` integer NOT NULL,
	PRIMARY KEY(`panel_id`, `bucket`)
);
