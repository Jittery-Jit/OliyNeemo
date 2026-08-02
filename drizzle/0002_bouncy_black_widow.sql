CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_sub` text NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`tag_epc` text NOT NULL,
	`home_hub_id` text,
	`last_seen_hub_id` text,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `items_owner_epc_unique` ON `items` (`owner_sub`,`tag_epc`);--> statement-breakpoint
CREATE INDEX `items_owner_updated_idx` ON `items` (`owner_sub`,`updated_at`);--> statement-breakpoint
CREATE TABLE `tag_observations` (
	`owner_sub` text NOT NULL,
	`hub_id` text NOT NULL,
	`epc` text NOT NULL,
	`rssi` real NOT NULL,
	`antenna` integer,
	`frequency` integer,
	`read_count` integer DEFAULT 1 NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	PRIMARY KEY(`hub_id`, `epc`)
);
--> statement-breakpoint
CREATE INDEX `tag_observations_owner_seen_idx` ON `tag_observations` (`owner_sub`,`last_seen_at`);