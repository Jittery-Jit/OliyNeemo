CREATE TABLE `mqtt_gateway_pairing_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_sub` text NOT NULL,
	`owner_email` text NOT NULL,
	`gateway_name` text NOT NULL,
	`code_hash` text NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mqtt_gateway_pairing_codes_code_hash_unique` ON `mqtt_gateway_pairing_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `mqtt_gateway_pairing_owner_idx` ON `mqtt_gateway_pairing_codes` (`owner_sub`,`expires_at`);--> statement-breakpoint
CREATE TABLE `mqtt_gateways` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_sub` text NOT NULL,
	`owner_email` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`platform` text,
	`broker_host` text DEFAULT '127.0.0.1' NOT NULL,
	`broker_port` integer DEFAULT 1883 NOT NULL,
	`broker_connected` integer DEFAULT false NOT NULL,
	`registered_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_broker_message_at` integer,
	`revoked_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mqtt_gateways_token_hash_unique` ON `mqtt_gateways` (`token_hash`);--> statement-breakpoint
CREATE INDEX `mqtt_gateways_owner_idx` ON `mqtt_gateways` (`owner_sub`,`registered_at`);--> statement-breakpoint
CREATE INDEX `mqtt_gateways_token_idx` ON `mqtt_gateways` (`token_hash`);--> statement-breakpoint
CREATE TABLE `mqtt_hub_discoveries` (
	`gateway_id` text NOT NULL,
	`owner_sub` text NOT NULL,
	`hardware_id` text NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_topic` text NOT NULL,
	`claimed_hub_id` text,
	PRIMARY KEY(`gateway_id`, `hardware_id`)
);
--> statement-breakpoint
CREATE INDEX `mqtt_hub_discoveries_owner_idx` ON `mqtt_hub_discoveries` (`owner_sub`,`last_seen_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `mqtt_hub_discoveries_claimed_unique` ON `mqtt_hub_discoveries` (`claimed_hub_id`);