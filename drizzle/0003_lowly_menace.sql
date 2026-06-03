CREATE TABLE `agent_model_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL DEFAULT 0,
	`agentName` enum('discovery','mapping','generator','extractor') NOT NULL,
	`provider` enum('manus','openai','anthropic') NOT NULL DEFAULT 'manus',
	`modelId` varchar(100) NOT NULL DEFAULT 'default',
	`temperature` decimal(3,2) DEFAULT '0.10',
	`maxTokens` int DEFAULT 2048,
	`apiKey` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `agent_model_configs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `erp_configs` ADD `docUrl` varchar(1000);