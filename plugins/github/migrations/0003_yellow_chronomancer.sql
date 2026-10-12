ALTER TABLE `comments` ADD `author_is_bot` integer;--> statement-breakpoint
ALTER TABLE `review_threads` ADD `author_is_bot` integer;--> statement-breakpoint
ALTER TABLE `reviews` ADD `author_is_bot` integer;