CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_sub` text NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`length` real NOT NULL,
	`width` real NOT NULL,
	`unit` text DEFAULT 'ft' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `rooms_owner_idx` ON `rooms` (`owner_sub`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_profiles` (
	`user_sub` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`workspace_name` text NOT NULL,
	`onboarding_complete` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `hub_pairing_codes` ADD `room_id` text;--> statement-breakpoint
ALTER TABLE `hubs` ADD `room_id` text;--> statement-breakpoint
ALTER TABLE `items` ADD `room_id` text;--> statement-breakpoint
ALTER TABLE `room_labels` ADD `room_id` text;--> statement-breakpoint
ALTER TABLE `scan_sessions` ADD `room_id` text;--> statement-breakpoint
INSERT INTO `rooms` (`id`, `owner_sub`, `owner_email`, `name`, `length`, `width`, `unit`, `created_at`, `updated_at`)
SELECT 'legacy-' || lower(hex(randomblob(16))), `owner_sub`, `owner_email`, `name`, `length`, `width`, `unit`, `created_at`, `updated_at`
FROM `room_spaces`;--> statement-breakpoint
UPDATE `hubs`
SET `room_id` = (SELECT `id` FROM `rooms` WHERE `rooms`.`owner_sub` = `hubs`.`owner_sub` ORDER BY `created_at` ASC LIMIT 1)
WHERE `room_id` IS NULL;--> statement-breakpoint
UPDATE `items`
SET `room_id` = (SELECT `id` FROM `rooms` WHERE `rooms`.`owner_sub` = `items`.`owner_sub` ORDER BY `created_at` ASC LIMIT 1)
WHERE `room_id` IS NULL;--> statement-breakpoint
UPDATE `room_labels`
SET `room_id` = (SELECT `id` FROM `rooms` WHERE `rooms`.`owner_sub` = `room_labels`.`owner_sub` ORDER BY `created_at` ASC LIMIT 1)
WHERE `room_id` IS NULL;--> statement-breakpoint
UPDATE `scan_sessions`
SET `room_id` = (SELECT `id` FROM `rooms` WHERE `rooms`.`owner_sub` = `scan_sessions`.`owner_sub` ORDER BY `created_at` ASC LIMIT 1)
WHERE `room_id` IS NULL;--> statement-breakpoint
UPDATE `hub_pairing_codes`
SET `room_id` = (SELECT `id` FROM `rooms` WHERE `rooms`.`owner_sub` = `hub_pairing_codes`.`owner_sub` ORDER BY `created_at` ASC LIMIT 1)
WHERE `room_id` IS NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `user_profiles`
  (`user_sub`, `email`, `display_name`, `workspace_name`, `onboarding_complete`, `created_at`, `updated_at`)
SELECT m.`user_sub`, m.`user_email`, m.`user_name`, t.`name`, 1, m.`joined_at`, m.`joined_at`
FROM `team_members` m
INNER JOIN `teams` t ON t.`id` = m.`team_id`;--> statement-breakpoint
INSERT OR IGNORE INTO `user_profiles`
  (`user_sub`, `email`, `display_name`, `workspace_name`, `onboarding_complete`, `created_at`, `updated_at`)
SELECT
  `owner_sub`,
  `owner_email`,
  CASE
    WHEN instr(`owner_email`, '@') > 1 THEN substr(`owner_email`, 1, instr(`owner_email`, '@') - 1)
    ELSE `owner_email`
  END,
  'My workspace',
  1,
  `created_at`,
  `updated_at`
FROM `room_spaces`;
