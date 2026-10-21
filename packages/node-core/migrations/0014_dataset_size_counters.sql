-- A dataset's row and byte counts, kept by triggers so a write checks its caps without summing every row.
-- A row counts whether or not it is marked removed, and its bytes are its data and evidence. A correction's
-- bytes are its value.
ALTER TABLE `datasets` ADD `row_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `datasets` ADD `byte_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `datasets` SET
  `row_count` = (SELECT count(*) FROM `dataset_rows` r WHERE r.`dataset_id` = `datasets`.`id`),
  `byte_count` = (SELECT coalesce(sum(length(r.`data_json`) + coalesce(length(r.`evidence_json`), 0)), 0) FROM `dataset_rows` r WHERE r.`dataset_id` = `datasets`.`id`)
    + (SELECT coalesce(sum(length(c.`value_json`)), 0) FROM `dataset_corrections` c WHERE c.`dataset_id` = `datasets`.`id`);--> statement-breakpoint
CREATE TRIGGER `dataset_rows_size_insert` AFTER INSERT ON `dataset_rows`
BEGIN
  UPDATE `datasets` SET `row_count` = `row_count` + 1,
    `byte_count` = `byte_count` + length(NEW.`data_json`) + coalesce(length(NEW.`evidence_json`), 0)
  WHERE `id` = NEW.`dataset_id`;
END;--> statement-breakpoint
CREATE TRIGGER `dataset_rows_size_update` AFTER UPDATE OF `data_json`, `evidence_json` ON `dataset_rows`
BEGIN
  UPDATE `datasets` SET `byte_count` = `byte_count`
    + length(NEW.`data_json`) + coalesce(length(NEW.`evidence_json`), 0)
    - length(OLD.`data_json`) - coalesce(length(OLD.`evidence_json`), 0)
  WHERE `id` = NEW.`dataset_id`;
END;--> statement-breakpoint
CREATE TRIGGER `dataset_rows_size_delete` AFTER DELETE ON `dataset_rows`
BEGIN
  UPDATE `datasets` SET `row_count` = `row_count` - 1,
    `byte_count` = `byte_count` - length(OLD.`data_json`) - coalesce(length(OLD.`evidence_json`), 0)
  WHERE `id` = OLD.`dataset_id`;
END;--> statement-breakpoint
CREATE TRIGGER `dataset_corrections_size_insert` AFTER INSERT ON `dataset_corrections`
BEGIN
  UPDATE `datasets` SET `byte_count` = `byte_count` + length(NEW.`value_json`) WHERE `id` = NEW.`dataset_id`;
END;--> statement-breakpoint
CREATE TRIGGER `dataset_corrections_size_update` AFTER UPDATE OF `value_json` ON `dataset_corrections`
BEGIN
  UPDATE `datasets` SET `byte_count` = `byte_count` + length(NEW.`value_json`) - length(OLD.`value_json`)
  WHERE `id` = NEW.`dataset_id`;
END;--> statement-breakpoint
CREATE TRIGGER `dataset_corrections_size_delete` AFTER DELETE ON `dataset_corrections`
BEGIN
  UPDATE `datasets` SET `byte_count` = `byte_count` - length(OLD.`value_json`) WHERE `id` = OLD.`dataset_id`;
END;
