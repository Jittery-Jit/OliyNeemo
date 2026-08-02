CREATE TABLE `hub_scan_jobs` (
	`scan_id` text NOT NULL,
	`hub_id` text NOT NULL,
	`owner_sub` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`requested_at` integer NOT NULL,
	`dispatched_at` integer,
	`completed_at` integer,
	`reading_count` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`scan_id`, `hub_id`)
);
--> statement-breakpoint
CREATE INDEX `hub_scan_jobs_hub_status_idx` ON `hub_scan_jobs` (`hub_id`,`status`,`requested_at`);--> statement-breakpoint
CREATE INDEX `hub_scan_jobs_scan_idx` ON `hub_scan_jobs` (`scan_id`);--> statement-breakpoint
CREATE TABLE `scan_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_sub` text NOT NULL,
	`owner_email` text NOT NULL,
	`mode` text NOT NULL,
	`target_item_id` text,
	`target_epc` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer
);
--> statement-breakpoint
CREATE INDEX `scan_sessions_owner_created_idx` ON `scan_sessions` (`owner_sub`,`created_at`);