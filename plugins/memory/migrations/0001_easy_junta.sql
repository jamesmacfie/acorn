CREATE TABLE `memory_promotion_receipts` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`candidate_revision` integer NOT NULL,
	`payload_hash` text NOT NULL,
	`payload_json` text NOT NULL,
	`scope_json` text NOT NULL,
	`target_path_identity` text NOT NULL,
	`expected_base_hash` text,
	`device_id` text NOT NULL,
	`state` text NOT NULL,
	`target_reference` text,
	`failure_code` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
