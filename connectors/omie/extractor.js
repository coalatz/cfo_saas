const axios = require('axios');
const auth = require('./auth');

async function extractRawData(credentials, entity, baseUrl, maxPages = 100) {
  const entityMapping = {
    "invoices": {
      "endpoint": {
        "method": "POST",
        "path": "/produtos/notaentrada/",
        "action": "ListarNotaEnt",
        "queryParams": [],
        "bodyParams": []
      },
      "envelope": "notas",
      "dePara": {
        "external_id": [
          "codigo_lancamento_integracao"
        ],
        "customer_name": [
          "codigo_cliente_fornecedor"
        ],
        "issue_date": [
          "data_previsao"
        ],
        "gross_amount": [
          "valor_documento"
        ]
      }
    },
    "receivables": {
      "endpoint": {
        "method": "POST",
        "path": "/financas/contareceber/",
        "action": "ListarContasReceber",
        "queryParams": [],
        "bodyParams": []
      },
      "envelope": "conta_receber_cadastro",
      "dePara": {
        "external_id": [
          "codigo_lancamento_integracao"
        ],
        "customer_name": [
          "codigo_cliente_fornecedor"
        ],
        "issue_date": [
          "data_previsao"
        ],
        "due_date": [
          "data_vencimento"
        ],
        "gross_amount": [
          "valor_documento"
        ],
        "paid_amount": [
          "valor_documento"
        ],
        "document_type": [
          "codigo_categoria"
        ],
        "document_number": [
          "codigo_lancamento_integracao"
        ]
      }
    },
    "payables": {
      "endpoint": {
        "method": "POST",
        "path": "/financas/contapagar/",
        "action": "ListarContasPagar",
        "queryParams": [],
        "bodyParams": []
      },
      "envelope": "conta_pagar_cadastro",
      "dePara": {
        "external_id": [
          "codigo_lancamento_integracao"
        ],
        "supplier_name": [
          "codigo_cliente_fornecedor"
        ],
        "issue_date": [
          "data_previsao"
        ],
        "due_date": [
          "data_vencimento"
        ],
        "gross_amount": [
          "valor_documento"
        ],
        "paid_amount": [
          "valor_documento"
        ],
        "document_type": [
          "codigo_categoria"
        ],
        "document_number": [
          "codigo_lancamento_integracao"
        ],
        "category": [
          "codigo_categoria"
        ]
      }
    },
    "customers": {
      "endpoint": {
        "method": "POST",
        "path": "/geral/clientes/",
        "action": "ListarClientes",
        "queryParams": [],
        "bodyParams": []
      },
      "envelope": "clientes_cadastro",
      "dePara": {
        "external_id": [
          "codigo_cliente_integracao",
          "codigo_cliente_omie"
        ],
        "name": [
          "razao_social",
          "nome_fantasia"
        ],
        "document": [
          "cnpj_cpf"
        ],
        "email": [
          "email"
        ],
        "phone": [
          "codigo_cliente_integracao"
        ],
        "city": [
          "codigo_cliente_integracao"
        ],
        "state": [
          "codigo_cliente_integracao"
        ]
      }
    }
  };

  const entityConfig = entityMapping[entity];
  if (!entityConfig) {
    throw new Error(`Entity "${entity}" is not supported for Omie`);
  }

  const { endpoint, envelope } = entityConfig;
  const { method, path, action } = endpoint;

  const pagination = {
    pageParam: "pagina",
    sizeParam: "registros_por_pagina",
    defaultPageSize: 50
  };

  let page = 1;
  let allRecords = [];
  let iterationCount = 0;
  const maxIterations = 100;

  while (iterationCount < maxIterations && page <= maxPages) {
    iterationCount++;

    let data = auth.getAuthBody(credentials, action);
    if (!data.param || typeof data.param !== 'object' || Array.isArray(data.param)) {
      data.param = {};
    }
    data.param[pagination.pageParam] = page;
    data.param[pagination.sizeParam] = pagination.defaultPageSize;

    const params = auth.getAuthQueryParams(credentials);

    let retryCount = 0;
    let requestSucceeded = false;
    let responseData = null;
    let lastError = null;

    while (retryCount < 3) {
      try {
        const response = await axios({
          method,
          url: baseUrl + path,
          data,
          params,
          timeout: 30000
        });
        requestSucceeded = true;
        responseData = response.data;
        break;
      } catch (error) {
        if (error.response && (error.response.status === 500 || error.response.status === 404)) {
          requestSucceeded = true;
          responseData = null;
          break;
        }
        const status = error.response ? error.response.status : null;
        const isRetryable = [429, 503].includes(status) || !error.response;
        if (isRetryable && retryCount < 2) {
          const waitTime = Math.pow(2, retryCount + 1) * 1000;
          await new Promise(resolve => setTimeout(resolve, waitTime));
          retryCount++;
          continue;
        } else {
          requestSucceeded = false;
          lastError = error;
          break;
        }
      }
    }

    if (!requestSucceeded) {
      break;
    }

    if (responseData === null) {
      break;
    }

    let records = [];
    if (responseData && responseData.hasOwnProperty(envelope)) {
      const envelopeData = responseData[envelope];
      if (Array.isArray(envelopeData)) {
        records = envelopeData;
      }
    }

    if (records.length === 0 && responseData && typeof responseData === 'object') {
      let maxLength = 0;
      let largestArray = null;
      for (const key in responseData) {
        if (responseData.hasOwnProperty(key) && Array.isArray(responseData[key])) {
          if (responseData[key].length > maxLength) {
            maxLength = responseData[key].length;
            largestArray = responseData[key];
          }
        }
      }
      if (largestArray) {
        records = largestArray;
      }
    }

    const totalKeys = ["total_de_registros", "totalRegistros", "total_records"];
    let totalRecords = null;
    for (const key of totalKeys) {
      if (responseData.hasOwnProperty(key) && typeof responseData[key] === 'number') {
        totalRecords = responseData[key];
        break;
      }
    }
    if (totalRecords === 0) {
      break;
    }

    let hasErrorList = false;
    if (responseData && typeof responseData === 'object') {
      for (const key in responseData) {
        if (responseData.hasOwnProperty(key) && Array.isArray(responseData[key])) {
          const arr = responseData[key];
          if (arr.length > 0) {
            const firstItem = arr[0];
            if (typeof firstItem === 'object' && firstItem !== null) {
              if (('CODIGO' in firstItem && 'MENSAGEM' in firstItem) ||
                  ('code' in firstItem && 'message' in firstItem) ||
                  ('faultstring' in firstItem)) {
                hasErrorList = true;
                break;
              }
            }
          }
        }
      }
    }
    if (hasErrorList) {
      break;
    }

    allRecords = allRecords.concat(records);

    if (records.length < pagination.defaultPageSize || records.length === 0) {
      break;
    }

    page++;
  }

  return allRecords;
}

module.exports = { extractRawData };