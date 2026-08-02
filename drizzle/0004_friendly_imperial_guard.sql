CREATE TABLE `hub_placements` (
	`hub_id` text PRIMARY KEY NOT NULL,
	`owner_sub` text NOT NULL,
	`left_distance` real NOT NULL,
	`right_distance` real NOT NULL,
	`top_distance` real NOT NULL,
	`bottom_distance` real NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `hub_placements_owner_idx` ON `hub_placements` (`owner_sub`);--> statement-breakpoint
CREATE TABLE `room_spaces` (
	`owner_sub` text PRIMARY KEY NOT NULL,
	`owner_email` text NOT NULL,
	`name` text DEFAULT 'My room' NOT NULL,
	`length` real NOT NULL,
	`width` real NOT NULL,
	`unit` text DEFAULT 'ft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
