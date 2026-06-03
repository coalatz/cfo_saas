ALTER TABLE `erp_configs` ADD `oauthState` varchar(128);--> statement-breakpoint
ALTER TABLE `erp_configs` ADD `refreshToken` text;--> statement-breakpoint
ALTER TABLE `erp_configs` ADD `tokenExpiresAt` timestamp;