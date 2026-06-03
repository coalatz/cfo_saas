ALTER TABLE `canonical_customers` ADD CONSTRAINT `uniq_tenant_source_external` UNIQUE(`tenantId`,`source`,`externalId`);--> statement-breakpoint
ALTER TABLE `canonical_invoices` ADD CONSTRAINT `uniq_tenant_source_external` UNIQUE(`tenantId`,`source`,`externalId`);--> statement-breakpoint
ALTER TABLE `canonical_payables` ADD CONSTRAINT `uniq_tenant_source_external` UNIQUE(`tenantId`,`source`,`externalId`);--> statement-breakpoint
ALTER TABLE `canonical_receivables` ADD CONSTRAINT `uniq_tenant_source_external` UNIQUE(`tenantId`,`source`,`externalId`);