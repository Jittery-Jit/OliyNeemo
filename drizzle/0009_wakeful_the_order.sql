ALTER TABLE `hubs` ADD `mac_address` text;--> statement-breakpoint
ALTER TABLE `hubs` ADD `ip_address` text;--> statement-breakpoint
ALTER TABLE `hubs` ADD `ssid` text;--> statement-breakpoint
ALTER TABLE `hubs` ADD `connection_state` text DEFAULT 'UNPROVISIONED' NOT NULL;--> statement-breakpoint
ALTER TABLE `hubs` ADD `connection_error` text;