CREATE TABLE `mqtt_gateway_events` (
	`gateway_id` text NOT NULL,
	`event_id` text NOT NULL,
	`received_at` integer NOT NULL,
	PRIMARY KEY(`gateway_id`, `event_id`)
);
--> statement-breakpoint
CREATE INDEX `mqtt_gateway_events_received_idx` ON `mqtt_gateway_events` (`received_at`);