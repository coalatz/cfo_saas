const mapper = {
  invoices: {
    endpoint: {
      method: "GET",
      path: "/v1/financeiro/cobranca/parcela/{id}",
      action: "ConsultarParcela",
      queryParams: [],
      bodyParams: []
    },
    envelope: "parcela",
    dePara: {
      external_id: ["id"],
      customer_name: ["cliente.nome"],
      issue_date: ["dataEmissao"],
      gross_amount: ["valorTotal"]
    }
  },
  receivables: {
    endpoint: {
      method: "GET",
      path: "/v1/financeiro/cobranca/parcela/{id}",
      action: "ConsultarParcela",
      queryParams: [],
      bodyParams: []
    },
    envelope: "parcela",
    dePara: {
      external_id: ["id"],
      customer_name: ["cliente.nome"],
      issue_date: ["dataEmissao"],
      due_date: ["dataVencimento"],
      gross_amount: ["valorTotal"],
      paid_amount: ["valorPago"],
      document_type: ["tipoDocumento"],
      document_number: ["numeroDocumento"]
    }
  },
  payables: {
    endpoint: {
      method: "GET",
      path: "/v1/financeiro/cobranca/parcela/{id}",
      action: "ConsultarParcela",
      queryParams: [],
      bodyParams: []
    },
    envelope: "parcela",
    dePara: {
      external_id: ["id"],
      supplier_name: ["fornecedor.nome"],
      issue_date: ["dataEmissao"],
      due_date: ["dataVencimento"],
      gross_amount: ["valorTotal"],
      paid_amount: ["valorPago"],
      document_type: ["tipoDocumento"],
      document_number: ["numeroDocumento"],
      category: ["categoria"]
    }
  },
  customers: {
    endpoint: {
      method: "GET",
      path: "/v1/pessoas/clientes/{id}",
      action: "ConsultarCliente",
      queryParams: [],
      bodyParams: []
    },
    envelope: "cliente",
    dePara: {
      external_id: ["id"],
      name: ["nome"],
      document: ["documento"],
      email: ["email"],
      phone: ["telefone"],
      city: ["cidade"],
      state: ["estado"]
    }
  }
};

function normalize(raw, entity) {
  const mapping = mapper[entity];
  if (!mapping) {
    throw new Error(`Entity '${entity}' not found in mapper.`);
  }

  const envelope = mapping.envelope;
  const dePara = mapping.dePara;

  const normalized = {};

  Object.keys(dePara).forEach(key => {
    const fields = dePara[key];
    const values = raw[fields[0]];
    if (values) {
      normalized[key] = values;
    }
  });

  return { envelope, data: normalized };
}

module.exports = { normalize };