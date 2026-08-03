CREATE TABLE `devices` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`secret_hash` blob NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE INDEX `devices_revoked_idx` ON `devices` (`revoked_at`);--> statement-breakpoint
CREATE TABLE `idempotency` (
	`device_id` text NOT NULL,
	`key` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer NOT NULL,
	`response_body` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	PRIMARY KEY(`device_id`, `key`)
);
--> statement-breakpoint
CREATE INDEX `idempotency_expiry_idx` ON `idempotency` (`expires_at`);