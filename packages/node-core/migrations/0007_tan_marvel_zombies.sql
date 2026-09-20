CREATE TABLE `query_publication_holds` (
	`query_id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`plan` text NOT NULL,
	`revision` integer,
	`released` integer DEFAULT false NOT NULL
);
