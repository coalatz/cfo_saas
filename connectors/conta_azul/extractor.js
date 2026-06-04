async function extractRawData(credentials, entity, baseUrl, maxPages = 100) {
  const axios = require('axios');
  const auth = require('./auth');

  const entityMap = {
    "invoices": {
      "endpoint": {
        "method": "GET",
        "path": "/v1/venda/busca",
        "action": "List sales",
        "queryParams": [],
        "bodyParams": []
      },
      "envelope": "vendas"
    },
    "receivables": {
      "endpoint": {
        "method": "GET",
        "path": "/v1/venda/busca",
        "action": "List sales (closest alternative for receivables)",
        "queryParams": [],
        "bodyParams": []
      },
      "envelope": ""
    },
    "payables": {
      "endpoint": {
        "method": "GET",
        "path": "/v1/venda/busca",
        "action": "List sales (closest alternative for payables)",
        "queryParams": [],
        "bodyParams": []
      },
      "envelope": ""
    },
    "customers": {
      "endpoint": {
        "method": "GET",
        "path": "/v1/venda/busca",
        "action": "List sales (closest alternative for customers)",
        "queryParams": [],
        "bodyParams": []
      },
      "envelope": ""
    }
  };

  if (!entityMap[entity]) {
    throw new Error(`Entity ${entity} not supported for conta_azul`);
  }

  const { endpoint, envelope } = entityMap[entity];
  const { method, path, action } = endpoint;
  const paginationParams = { pageParam: "page", sizeParam: "size", defaultPageSize: 50 };
  const { pageParam, sizeParam, defaultPageSize } = paginationParams;
  let page = 0;
  const size = defaultPageSize;
  const allRecords = [];

  while (true) {
    if (page > maxPages) break;

    try {
      const authHeaders = auth.getAuthHeaders(credentials);
      const authBody = auth.getAuthBody(credentials, action);
      const authQueryParams = auth.getAuthQueryParams(credentials);

      const params = {
        ...authQueryParams,
        [pageParam]: page,
        [sizeParam]: size
      };

      let data;
      if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
        data = { ...authBody };
      }

      const url = baseUrl + path;
      const response = await axios({
        method,
        url,
        headers: authHeaders,
        params,
        data,
        timeout: 30000
      });

      let recordsArray = [];
      const responseData = response.data;

      if (envelope && responseData.hasOwnProperty(envelope) && Array.isArray(responseData[envelope])) {
        recordsArray = responseData[envelope];
      } else {
        let maxLength = 0;
        let foundArray = null;
        for (const key in responseData) {
          if (Array.isArray(responseData[key]) && responseData[key].length > maxLength) {
            maxLength = responseData[key].length;
            foundArray = responseData[key];
          }
        }
        if (foundArray) {
          recordsArray = foundArray;
        }
      }

      let hasZeroTotal = false;
      const totalKeys = ['total_de_registros', 'totalRegistros', 'total_records'];
      for (const key of totalKeys) {
        if (responseData.hasOwnProperty(key) && typeof responseData[key] === 'number' && responseData[key] === 0) {
          hasZeroTotal = true;
          break;
        }
      }
      if (hasZeroTotal) break;

      let hasErrorArray = false;
      for (const key in responseData) {
        if (Array.isArray(responseData[key]) && responseData[key].length > 0) {
          const firstItem = responseData[key][0];
          if (
            (firstItem.hasOwnProperty('CODIGO') && firstItem.hasOwnProperty('MENSAGEM')) ||
            (firstItem.hasOwnProperty('code') && firstItem.hasOwnProperty('message')) ||
            (firstItem.hasOwnProperty('faultstring'))
          ) {
            hasErrorArray = true;
            break;
          }
        }
      }
      if (hasErrorArray) break;

      allRecords.push(...recordsArray);

      if (recordsArray.length === 0) break;

      page++;
    } catch (error) {
      if (error.response && (error.response.status === 500 || error.response.status === 404)) {
        break;
      }
      if (error.code === 'ECONNABORTED' || error.code === 'ENETUNREACH' || error.code === 'ECONNRESET') {
        throw new Error(`Network error: ${error.message}`);
      }
      if (error.response && (error.response.status === 429 || error.response.status === 503)) {
        const attempt = error.retryCount || 0;
        if (attempt >= 2) {
          throw new Error(`Max retries exceeded for status ${error.response.status}`);
        }
        const waitTime = Math.pow(2, attempt + 1) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        error.retryCount = attempt + 1;
        continue;
      }
      throw error;
    }
  }

  return allRecords;
}

module.exports = { extractRawData };