CREATE TABLE `ignored_repos` (
	`owner` text NOT NULL,
	`repo` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`owner`, `repo`)
);
