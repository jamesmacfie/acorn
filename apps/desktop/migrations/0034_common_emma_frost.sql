ALTER TABLE `api_tokens` ADD `scopes_json` text DEFAULT '["read"]' NOT NULL;
--> statement-breakpoint
UPDATE `api_tokens`
SET `scopes_json` = CASE
  WHEN `can_write` = 1 THEN '["read","write"]'
  ELSE '["read"]'
END;
