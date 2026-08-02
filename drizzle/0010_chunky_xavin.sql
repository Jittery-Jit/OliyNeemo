CREATE TABLE `scan_tag_observations` (
	`scan_id` text NOT NULL,
	`owner_sub` text NOT NULL,
	`hub_id` text NOT NULL,
	`epc` text NOT NULL,
	`rssi` real NOT NULL,
	`antenna` integer,
	`frequency` integer,
	`read_count` integer DEFAULT 1 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`scan_id`, `hub_id`, `epc`)
);
--> statement-breakpoint
CREATE INDEX `scan_tag_observations_owner_scan_idx` ON `scan_tag_observations` (`owner_sub`,`scan_id`);