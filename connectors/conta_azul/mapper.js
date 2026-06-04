const FALLBACKS = {
  "invoices": {
    "envelope": "vendas",
    "dePara": {
      "external_id": [
        "id",
        "numero"
      ],
      "customer_name": [
        "cliente.nome",
        "cliente.razao_social"
      ],
      "issue_date": [
        "data"
      ],
      "gross_amount": [
        "valor_total"
      ]
    }
  },
  "receivables": {
    "envelope": "",
    "dePara": {
      "external_id": [
        "id",
        "numero"
      ],
      "customer_name": [
        "cliente.nome",
        "cliente.razao_social"
      ],
      "issue_date": [
        "data"
      ],
      "due_date": [
        "data_vencimento"
      ],
      "gross_amount": [
        "valor_total"
      ],
      "paid_amount": [
        "valor_pago"
      ],
      "document_type": [
        "tipo_documento"
      ],
      "document_number": [
        "numero_documento"
      ]
    }
  },
  "payables": {
    "envelope": "",
    "dePara": {
      "external_id": [
        "id",
        "numero"
      ],
      "supplier_name": [
        "fornecedor.nome",
        "fornecedor.razao_social"
      ],
      "issue_date": [
        "data"
      ],
      "due_date": [
        "data_vencimento"
      ],
      "gross_amount": [
        "valor_total"
      ],
      "paid_amount": [
        "valor_pago"
      ],
      "document_type": [
        "tipo_documento"
      ],
      "document_number": [
        "numero_documento"
      ],
      "category": [
        "categoria"
      ]
    }
  },
  "customers": {
    "envelope": "",
    "dePara": {
      "external_id": [
        "id",
        "numero"
      ],
      "name": [
        "cliente.nome",
        "cliente.razao_social"
      ],
      "document": [
        "cliente.cnpj",
        "cliente.cpf"
      ],
      "email": [
        "cliente.email"
      ],
      "phone": [
        "cliente.telefone"
      ],
      "city": [
        "cliente.endereco.cidade"
      ],
      "state": [
        "cliente.endereco.estado"
      ]
    }
  }
};

function getValueByPath(obj, path) {
  if (!obj || typeof obj !== 'object') return undefined;
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length; i++) {
    if (current === null || current === undefined) return undefined;
    current = current[parts[i]];
  }
  return current;
}

function normalizeDate(dateStr) {
  if (typeof dateStr !== 'string') {
    dateStr = String(dateStr);
  }
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateStr)) {
    const [day, month, year] = dateStr.split('/');
    return `${year}-${month}-${day}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.substring(0, 10);
  }
  return dateStr;
}

function normalizeAmount(value) {
  let s = String(value);
  if (s.includes(',')) {
    s = s.replace(/\./g, '');
    s = s.replace(',', '.');
  }
  return s;
}

function toCamelCase(str) {
  return str.replace(/_([a-z])/g, (match, p1) => p1.toUpperCase());
}

function normalize(raw, entity) {
  if (!FALLBACKS[entity]) {
    return {};
  }
  const dePara = FALLBACKS[entity].dePara;
  const result = {};
  for (const [snakeCaseKey, sourcePaths] of Object.entries(dePara)) {
    let value = undefined;
    for (const path of sourcePaths) {
      const val = getValueByPath(raw, path);
      if (val !== undefined && val !== null) {
        value = val;
        break;
      }
    }
    if (value !== undefined && value !== null) {
      let processedValue;
      if (snakeCaseKey === 'issue_date' || snakeCaseKey === 'due_date') {
        processedValue = normalizeDate(value);
      } else if (snakeCaseKey === 'gross_amount' || snakeCaseKey === 'paid_amount') {
        processedValue = normalizeAmount(value);
      } else {
        processedValue = value;
      }
      const camelCaseKey = toCamelCase(snakeCaseKey);
      result[camelCaseKey] = processedValue;
    }
  }
  return result;
}

module.exports = { normalize };