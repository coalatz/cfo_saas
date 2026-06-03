const axios = require('axios');
const auth = require('./auth');

const entityMapping = {
  "invoices": {
    "endpoint": {
      "method": "GET",
      "path": "/v1/financeiro/cobranca/parcela/{id}",
      "action": "ConsultarParcela",
      "queryParams": [],
      "bodyParams": []
    },
    "envelope": "parcela",
    "dePara": {
      "external_id": [
        "id"
      ],
      "customer_name": [
        "cliente.nome"
      ],
      "issue_date": [
        "dataEmissao"
      ],
      "gross_amount": [
        "valorTotal"
      ]
    }
  },
  "receivables": {
    "endpoint": {
      "method": "GET",
      "path": "/v1/financeiro/cobranca/parcela/{id}",
      "action": "ConsultarParcela",
      "queryParams": [],
      "bodyParams": []
    },
    "envelope": "parcela",
    "dePara": {
      "external_id": [
        "id"
      ],
      "customer_name": [
        "cliente.nome"
      ],
      "issue_date": [
        "dataEmissao"
      ],
      "due_date": [
        "dataVencimento"
      ],
      "gross_amount": [
        "valorTotal"
      ],
      "paid_amount": [
        "valorPago"
      ],
      "document_type": [
        "tipoDocumento"
      ],
      "document_number": [
        "numeroDocumento"
      ]
    }
  },
  "payables": {
    "endpoint": {
      "method": "GET",
      "path": "/v1/financeiro/cobranca/parcela/{id}",
      "action": "ConsultarParcela",
      "queryParams": [],
      "bodyParams": []
    },
    "envelope": "parcela",
    "dePara": {
      "external_id": [
        "id"
      ],
      "supplier_name": [
        "fornecedor.nome"
      ],
      "issue_date": [
        "dataEmissao"
      ],
      "due_date": [
        "dataVencimento"
      ],
      "gross_amount": [
        "valorTotal"
      ],
      "paid_amount": [
        "valorPago"
      ],
      "document_type": [
        "tipoDocumento"
      ],
      "document_number": [
        "numeroDocumento"
      ],
      "category": [
        "categoria"
      ]
    }
  },
  "customers": {
    "endpoint": {
      "method": "GET",
      "path": "/v1/pessoas/clientes/{id}",
      "action": "ConsultarCliente",
      "queryParams": [],
      "bodyParams": []
    },
    "envelope": "cliente",
    "dePara": {
      "external_id": [
        "id"
      ],
      "name": [
        "nome"
      ],
      "document": [
        "documento"
      ],
      "email": [
        "email"
      ],
      "phone": [
        "telefone"
      ],
      "city": [
        "cidade"
      ],
      "state": [
        "estado"
      ]
    }
  }
};

async function extractRawData(credentials, entity, baseUrl) {
  const endpoint = entityMapping[entity].endpoint;
  const authBody = auth.getAuthBody(credentials, endpoint.action);
  const authQueryParams = auth.getAuthQueryParams(credentials);
  const authHeaders = auth.getAuthHeaders(credentials);
  const url = `${baseUrl}${endpoint.path.replace('{id}', '')}`;
  const body = authBody;
  const queryParams = { ...authQueryParams };

  let response;
  let currentPage = 1;
  let maxIterations = 50;

  do {
    response = await axios({
      method: endpoint.method,
      url,
      data: body,
      headers: { ...authHeaders },
      params: { ...queryParams, page: currentPage }
    });

    const data = response.data;
    const envelope = entityMapping[entity].envelope;
    const dePara = entityMapping[entity].dePara;

    const extractedData = data[envelope].map(item => {
      const extractedItem = {};
      dePara.forEach((key, index) => {
        extractedItem[key] = item[key];
      });
      return extractedItem;
    });

    console.log(extractedData);

    currentPage++;
  } while (response.data[envelope].length > 0 && currentPage <= maxIterations);

  return response;
}

module.exports = { extractRawData };