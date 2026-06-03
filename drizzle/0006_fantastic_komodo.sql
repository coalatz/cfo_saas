ALTER TABLE `agent_model_configs` MODIFY COLUMN `provider` varchar(50) NOT NULL DEFAULT 'manus';--> statement-breakpoint
ALTER TABLE `agent_pipelines` MODIFY COLUMN `erpType` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `canonical_customers` MODIFY COLUMN `source` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `canonical_invoices` MODIFY COLUMN `source` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `canonical_payables` MODIFY COLUMN `source` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `canonical_receivables` MODIFY COLUMN `source` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `erp_configs` MODIFY COLUMN `erpType` varchar(50) NOT NULL;--> statement-breakpoint
ALTER TABLE `extraction_logs` MODIFY COLUMN `erpType` varchar(50) NOT NULL;