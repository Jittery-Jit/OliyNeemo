CREATE TABLE `room_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_sub` text NOT NULL,
	`name` text NOT NULL,
	`left_distance` real NOT NULL,
	`front_distance` real NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `room_labels_owner_idx` ON `room_labels` (`owner_sub`,`created_at`);