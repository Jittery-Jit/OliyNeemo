CREATE TABLE `team_members` (
	`team_id` text NOT NULL,
	`user_sub` text NOT NULL,
	`user_email` text NOT NULL,
	`user_name` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joined_at` integer NOT NULL,
	PRIMARY KEY(`team_id`, `user_sub`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `team_members_user_unique` ON `team_members` (`user_sub`);--> statement-breakpoint
CREATE INDEX `team_members_team_idx` ON `team_members` (`team_id`,`joined_at`);--> statement-breakpoint
CREATE TABLE `teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`owner_sub` text NOT NULL,
	`invite_code` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teams_invite_code_unique` ON `teams` (`invite_code`);--> statement-breakpoint
CREATE INDEX `teams_owner_idx` ON `teams` (`owner_sub`);