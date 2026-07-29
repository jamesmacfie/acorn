DROP INDEX `http_requests_repo_folder_idx`;--> statement-breakpoint
DROP INDEX `http_requests_task_idx`;--> statement-breakpoint
ALTER TABLE `http_requests` ADD `user_id` text DEFAULT '__legacy_unscoped__' NOT NULL;--> statement-breakpoint
ALTER TABLE `http_requests` ADD `encrypted` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `http_requests_user_repo_folder_idx` ON `http_requests` (`user_id`,`repo_owner`,`repo_name`,`folder`);--> statement-breakpoint
CREATE INDEX `http_requests_user_task_idx` ON `http_requests` (`user_id`,`task_id`);--> statement-breakpoint
DROP INDEX `http_variables_repo_name_idx`;--> statement-breakpoint
ALTER TABLE `http_variables` ADD `user_id` text DEFAULT '__legacy_unscoped__' NOT NULL;--> statement-breakpoint
ALTER TABLE `http_variables` ADD `encrypted` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `http_variables_user_repo_name_idx` ON `http_variables` (`user_id`,`repo_owner`,`repo_name`,`name`);