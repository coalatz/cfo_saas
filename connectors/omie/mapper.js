function getValue(obj, path) {
  if (!obj || typeof path !== 'string') return undefined;
  const parts = path.split('.');
  let current = obj;
  for (const part of parts) {
    if (current == null) return undefined;
    current = current[part];
  }
  return current;
}

function formatDate(value) {
  if (value == null) return '';
  if (typeof value === 'number') {
    // treat as timestamp? not expected
    value = new Date(value).toISOString();
  }
  if (typeof value !== 'string') value = String(value);
  const trimmed = value.trim();
  if (!trimmed) return '';
  // ISO timestamp
  if (trimmed.includes('T') || trimmed.includes('Z')) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
    return '';
  }
  // DD/MM/YYYY
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/');
    if (parts.length === 3) {
      const [d, m, y] = parts.map(p => p.padStart(2, '0'));
      if (y.length === 4 && m.length === 2 && d.length === 2) {
        return `${y}-${m}-${d}`;
      }
    }
    return '';
  }
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  return '';
}

function formatAmount(value) {
  if (value === null || value === undefined) return '0';
  if (typeof value === 'number') {
    return parseFloat(value).toFixed(2);
  }
  if (typeof value !== 'string') {
    value = String(value);
  }
  const trimmed = value.trim().replace(/\s/g, '');
  if (!trimmed) return '0';
  let numStr = trimmed;
  // detect BR format: thousand separator '.' and decimal ','
  if (numStr.includes('.') && numStr.includes(',')) {
    // assume last comma is decimal separator
    numStr = numStr.replace(/\./g, '').replace(',', '.');
  } else if (numStr.includes(',') && !numStr.includes('.')) {
    // comma as decimal
    numStr = numStr.replace(',', '.');
  }
  // if only dot, assume decimal dot
  const n = parseFloat(numStr);
  return isNaN(n) ? '0' : n.toFixed(2);
}

function normalize(raw, entity) {
  const out = {
    externalId: '',
    customerName: '',
    supplierName: '',
    name: '',
    issueDate: '',
    dueDate: '',
    grossAmount: '0',
    paidAmount: '0',
    document: '',
    documentType: '',
    documentNumber: '',
    email: '',
    phone: '',
    city: '',
    state: '',
    category: ''
  };

  const entityLower = (entity || '').toLowerCase();

  // Helper to try multiple paths and return first non-empty
  function getFirst(paths) {
    for (const p of paths) {
      const val = getValue(raw, p);
      if (val !== undefined && val !== null && val !== '') return val;
    }
    return undefined;
  }

  if (entityLower === 'receivables') {
    out.externalId = getFirst(['codigo_lancamento_integracao']) || '';
    out.customerName = getFirst(['codigo_cliente_fornecedor'])?.toString() ?? '';
    out.issueDate = formatDate(getFirst(['data_previsao']));
    out.dueDate = formatDate(getFirst(['data_vencimento']));
    out.grossAmount = formatAmount(getFirst(['valor_documento']));
    out.paidAmount = '0'; // no paid amount field in example
    out.document = getFirst(['numero_documento']) ?? '';
    out.documentType = getFirst(['codigo_categoria']) ?? '';
    out.documentNumber = getFirst(['codigo_lancamento_integracao']) ?? '';
    out.email = '';
    out.phone = '';
    out.city = '';
    out.state = '';
    const cat = getFirst(['codigo_categoria']);
    out.category = cat !== undefined ? String(cat) : '';
  } else if (entityLower === 'payables') {
    out.externalId = getFirst(['codigo_lancamento_integracao']) || '';
    out.supplierName = getFirst(['codigo_cliente_fornecedor'])?.toString() ?? '';
    out.issueDate = formatDate(getFirst(['data_previsao']));
    out.dueDate = formatDate(getFirst(['data_vencimento']));
    out.grossAmount = formatAmount(getFirst(['valor_documento']));
    out.paidAmount = '0';
    out.document = getFirst(['numero_documento']) ?? '';
    out.documentType = getFirst(['codigo_categoria']) ?? '';
    out.documentNumber = getFirst(['codigo_lancamento_integracao']) ?? '';
    out.email = '';
    out.phone = '';
    out.city = '';
    out.state = '';
    const cat = getFirst(['codigo_categoria']);
    out.category = cat !== undefined ? String(cat) : '';
  } else if (entityLower === 'customers') {
    out.externalId = getFirst(['codigo_cliente_integracao', 'codigo_cliente_omie']) ?? '';
    out.name = getFirst(['razao_social', 'nome_fantasia']) ?? '';
    out.document = getFirst(['cnpj_cpf']) ?? '';
    out.email = getFirst(['email']) ?? '';
    out.phone = ''; // no phone field in example
    out.city = getFirst(['cidade']) ?? '';
    out.state = getFirst(['estado']) ?? '';
    out.customerName = '';
    out.supplierName = '';
    out.issueDate = '';
    out.dueDate = '';
    out.grossAmount = '0';
    out.paidAmount = '0';
    out.documentType = '';
    out.documentNumber = '';
    out.category = '';
  } else if (entityLower === 'invoices') {
    // fallback mapping for invoices
    out.externalId = getFirst(['codigo_lancamento_integracao']) ?? '';
    out.customerName = getFirst(['codigo_cliente_fornecedor'])?.toString() ?? '';
    out.issueDate = formatDate(getFirst(['data_previsao']));
    out.dueDate = '';
    out.grossAmount = formatAmount(getFirst(['valor_documento']));
    out.paidAmount = '0';
    out.document = getFirst(['numero_documento']) ?? '';
    out.documentType = getFirst(['codigo_categoria']) ?? '';
    out.documentNumber = getFirst(['codigo_lancamento_integracao']) ?? '';
    out.email = '';
    out.phone = '';
    out.city = '';
    out.state = '';
    out.supplierName = '';
    out.name = '';
    out.category = '';
  } else {
    // unknown entity: return empty defaults
  }

  return out;
}

module.exports = { normalize };