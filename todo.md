# CFO SaaS Extraction Platform - TODO

## Schema & Database
- [x] Tabela tenants (id, name, slug, created_at)
- [x] Tabela erp_configs (id, tenant_id, erp_type, credentials_json, status, doc_url)
- [x] Tabela agent_pipelines (id, tenant_id, erp_type, status, steps_json, created_at)
- [x] Tabela canonical_invoices (id, tenant_id, source, external_id, customer_name, issue_date, gross_amount, raw_storage_key, created_at)
- [x] Tabela extraction_logs (id, tenant_id, erp_type, status, records_processed, error_message, started_at, finished_at)
- [x] Tabela canonical_receivables
- [x] Tabela canonical_payables
- [x] Tabela canonical_customers
- [x] Tabela agent_model_configs (tenant_id, agent_name, provider, model_id, temperature, max_tokens, api_key)

## Backend - Routers tRPC
- [x] tenants.list / create / getById / update / delete
- [x] erpConfigs.upsert (com docUrl) / getByTenant
- [x] agents.runPipeline / getPipelines / getLatestPipeline / testDiscovery
- [x] modelConfigs.list / availableModels / save / delete
- [x] invoices.list / stats / globalStats
- [x] receivables.list / stats / globalStats
- [x] payables.list / stats / globalStats
- [x] customers.list / stats / globalStats
- [x] logs.list

## Backend - Agentes de IA (LangGraph)
- [x] DocFetcher: fetch multi-estratégia com cache 1h e limpeza de HTML via Cheerio
- [x] llmFactory: suporte a manus/openai/anthropic com catálogo de modelos
- [x] Pipeline LangGraph StateGraph com nós: discovery → mapping → generator → extractor → END
- [x] Discovery Node: usa DocFetcher para ler doc real + LLM para extrair endpoints/auth/campos
- [x] Mapping Node: LLM gera dicionário de-para para modelo canônico (4 entidades)
- [x] Generator Node: LLM gera estratégia de extração (auth, paginação, envelopes)
- [x] Extractor Node: executa extração paginada com suporte a envelopes variados
- [x] Normalização e persistência no modelo canônico
- [x] Upload de raw data para file storage (S3)
- [x] runDiscoveryOnly: executa só o nó Discovery para testar URL de doc

## Frontend - Páginas
- [x] Layout global com sidebar elegante (AppLayout) + item "Modelos IA"
- [x] Dashboard: métricas consolidadas, posição líquida, logs recentes
- [x] Tenants: listagem, criação, configuração de credenciais ERP
- [x] TenantDetail: credenciais ERP + campo docUrl + botão "Modelos IA" + histórico de pipelines
- [x] Agents: pipeline visual step-by-step com resultados expandíveis
- [x] ModelConfigs: configuração de modelo LLM por agente e tenant
- [x] Invoices: tabela canônica com filtros
- [x] Receivables: tabela canônica com filtros
- [x] Payables: tabela canônica com filtros
- [x] Customers: tabela canônica com filtros
- [x] Logs: histórico de execuções

## Testes
- [x] 36 testes Vitest passando
- [x] Validação do modelo canônico (external_id, customer_name, issue_date, gross_amount)
- [x] Testes de receivables, payables, customers
- [x] Teste de testDiscovery com docSource
- [x] Testes de modelConfigs (list/availableModels/save/delete/validação de enum)

## OAuth2 Conta Azul
- [x] Coluna tokenExpiresAt e refreshToken em erp_configs
- [x] Rota GET /api/oauth/conta-azul/authorize — gera URL de autorização com state
- [x] Rota GET /api/oauth/conta-azul/callback — troca code por tokens e salva em erp_configs
- [x] Refresh automático de access_token via refresh_token antes de cada extração
- [x] Botão "Conectar via OAuth" na UI de TenantDetail
- [x] Status de conexão OAuth (conectado/expirado/não conectado)
- [x] Testes para o fluxo OAuth2
