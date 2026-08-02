CREATE INDEX `hub_pairing_owner_idx` ON `hub_pairing_codes` (`owner_sub`,`expires_at`);--> statement-breakpoint
CREATE INDEX `hubs_owner_idx` ON `hubs` (`owner_sub`,`paired_at`);