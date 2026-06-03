CREATE TABLE `canonical_customers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`source` enum('conta_azul','omie') NOT NULL,
	`externalId` varchar(255) NOT NULL,
	`name` varchar(255) NOT NULL,
	`tradeName` varchar(255),
	`document` varchar(20),
	`documentType` enum('cpf','cnpj','other'),
	`email` varchar(320),
	`phone` varchar(30),
	`city` varchar(100),
	`state` varchar(2),
	`country` varchar(2) DEFAULT 'BR',
	`status` enum('active','inactive','blocked') NOT NULL DEFAULT 'active',
	`rawStorageKey` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `canonical_customers_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `canonical_payables` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`source` enum('conta_azul','omie') NOT NULL,
	`externalId` varchar(255) NOT NULL,
	`supplierName` varchar(255),
	`issueDate` varchar(10),
	`dueDate` varchar(10),
	`grossAmount` decimal(15,2),
	`paidAmount` decimal(15,2),
	`documentType` varchar(50),
	`documentNumber` varchar(100),
	`category` varchar(100),
	`status` enum('open','paid','overdue','cancelled','partial') NOT NULL DEFAULT 'open',
	`rawStorageKey` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `canonical_payables_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `canonical_receivables` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tenantId` int NOT NULL,
	`source` enum('conta_azul','omie') NOT NULL,
	`externalId` varchar(255) NOT NULL,
	`customerName` varchar(255),
	`issueDate` varchar(10),
	`dueDate` varchar(10),
	`grossAmount` decimal(15,2),
	`paidAmount` decimal(15,2),
	`documentType` varchar(50),
	`documentNumber` varchar(100),
	`status` enum('open','paid','overdue','cancelled','partial') NOT NULL DEFAULT 'open',
	`rawStorageKey` varchar(500),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `canonical_receivables_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `canonical_invoices` MODIFY COLUMN `issueDate` varchar(10);--> statement-breakpoint
ALTER TABLE `extraction_logs` ADD `entityType` enum('invoices','receivables','payables','customers') DEFAULT 'invoices' NOT NULL;--> statement-breakpoint
ALTER TABLE `canonical_customers` ADD CONSTRAINT `canonical_customers_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `canonical_payables` ADD CONSTRAINT `canonical_payables_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `canonical_receivables` ADD CONSTRAINT `canonical_receivables_tenantId_tenants_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `tenants`(`id`) ON DELETE cascade ON UPDATE no action;