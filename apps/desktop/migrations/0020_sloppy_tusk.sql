PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_integrations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`label` text NOT NULL,
	`access_token` text NOT NULL,
	`auth_kind` text DEFAULT 'api-key' NOT NULL,
	`account` text,
	`scopes` text DEFAULT '[]' NOT NULL,
	`capabilities` text DEFAULT '{}' NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_validated_at` integer,
	`last_error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_integrations`("id", "user_id", "provider", "label", "access_token", "auth_kind", "account", "scopes", "capabilities", "config", "status", "last_validated_at", "last_error", "created_at", "updated_at")
SELECT
	"id",
	"user_id",
	"provider",
	"label",
	"access_token",
	'api-key',
	CASE
		WHEN "provider" = 'linear' AND json_extract("meta", '$.workspace') IS NOT NULL THEN json_object('id', json_extract("meta", '$.workspace'), 'label', json_extract("meta", '$.workspace'), 'type', 'workspace')
		WHEN "provider" = 'rollbar' AND json_extract("meta", '$.projectId') IS NOT NULL THEN json_object('id', CAST(json_extract("meta", '$.projectId') AS TEXT), 'label', json_extract("meta", '$.project'), 'type', 'project')
		ELSE NULL
	END,
	'[]',
	'{}',
	CASE WHEN "provider" = 'rollbar' THEN json_object('projectId', CAST(json_extract("meta", '$.projectId') AS TEXT)) ELSE '{}' END,
	'connected',
	NULL,
	NULL,
	"created_at",
	"created_at"
FROM `integrations`;--> statement-breakpoint
DROP TABLE `integrations`;--> statement-breakpoint
ALTER TABLE `__new_integrations` RENAME TO `integrations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
ALTER TABLE `task_links` ADD `ref_json` text;
