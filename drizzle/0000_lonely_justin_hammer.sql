CREATE TABLE `hub_pairing_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_sub` text NOT NULL,
	`owner_email` text NOT NULL,
	`hub_name` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hub_pairing_codes_code_hash_unique` ON `hub_pairing_codes` (`code_hash`);--> statement-breakpoint
CREATE TABLE `hubs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_sub` text NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`device_id` text NOT NULL,
	`device_token_hash` text NOT NULL,
	`firmware_version` text,
	`wifi_rssi` integer,
	`pos_x` real DEFAULT 50 NOT NULL,
	`pos_y` real DEFAULT 50 NOT NULL,
	`paired_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `hubs_device_id_unique` ON `hubs` (`device_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `hubs_device_token_hash_unique` ON `hubs` (`device_token_hash`);