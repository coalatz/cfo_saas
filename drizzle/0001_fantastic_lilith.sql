CREATE TABLE `agent_pipelines` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`erpType` enum('conta_azul','omie') NOT NULL,
	`status` enum('pending','running','completed','failed') NOT NULL DEFAULT 'pending',
	`currentStep` enum('discovery','mapping','generator','extractor','done') NOT NULL DEFAULT 'discovery',
	`discoveryResult` json,
	`mappingResult` json,
	`generatorResult` json,
	`extractorResult` json,
	`errorMessage` text,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`finishedAt` timestamp,
	CONSTRAINT `agent_pipelines_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `canonical_invoices` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`source` enum('conta_azul','omie') NOT NULL,
	`externalId` varchar(255) NOT NULL,
	`customerName` varchar(255),
	`issueDate` date,
	`grossAmount` decimal(15,2),
	`rawStorageKey` varchar(500),
	`status` enum('open','paid','overdue','cancelled') NOT NULL DEFAULT 'open',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `canonical_invoices_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `erp_configs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`erpType` enum('conta_azul','omie') NOT NULL,
	`credentials` json NOT NULL,
	`status` enum('pending','configured','active','error') NOT NULL DEFAULT 'pending',
	`lastTestedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `erp_configs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `extraction_logs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`pipelineId` int,
	`erpType` enum('conta_azul','omie') NOT NULL,
	`status` enum('running','success','failed','partial') NOT NULL DEFAULT 'running',
	`recordsProcessed` int DEFAULT 0,
	`recordsFailed` int DEFAULT 0,
	`errorMessage` text,
	`metadata` json,
	`startedAt` timestamp NOT NULL DEFAULT (now()),
	`finishedAt` timestamp,
	CONSTRAINT `extraction_logs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tenants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(255) NOT NULL,
	`slug` varchar(100) NOT NULL,
	`description` text,
	`status` enum('active','inactive') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tenants_id` PRIMARY KEY(`id`),
	CONSTRAINT `tenants_slug_unique` UNIQUE(`slug`)
);
--> statement-breakpoint
ALTER TABLE `agent_pipelines` ADD CONSTRAINT `agent_pipelines_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `canonical_invoices` ADD CONSTRAINT `canonical_invoices_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `erp_configs` ADD CONSTRAINT `erp_configs_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `extraction_logs` ADD CONSTRAINT `extraction_logs_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `extraction_logs` ADD CONSTRAINT `extraction_logs_pipelineId_agent_pipelines_id_fk` FOREIGN KEY (`pipelineId`) REFERENCES `agent_pipelines`(`id`) ON DELETE set null ON UPDATE no action;