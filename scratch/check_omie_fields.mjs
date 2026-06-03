import mysql from "mysql2/promise";
import axios from "axios";

const conn = await mysql.createConnection("mysql://root:root@localhost:3306/cfo_saas_db");
const [configs] = await conn.execute("SELECT credentials FROM erp_configs WHERE erpType='omie' LIMIT 1");
await conn.end();

if (!configs.length) { console.log("Nenhuma config omie no banco"); process.exit(1); }

// credentials pode ser objeto já ou string
const raw = configs[0].credentials;
const creds = typeof raw === "string" ? JSON.parse(raw) : raw;
console.log("Credenciais encontradas:", Object.keys(creds));

async function callOmie(path, call, pageSize = 1) {
  const payload = {
    app_key: creds.app_key,
    app_secret: creds.app_secret,
    call,
    param: [{ pagina: 1, registros_por_pagina: pageSize, apenas_importado_api: "N" }]
  };
  const res = await axios.post(`https://app.omie.com.br/api/v1${path}`, payload, {
    headers: { "Content-Type": "application/json" }
  });
  return res.data;
}

// RECEIVABLES
try {
  const data = await callOmie("/financas/contareceber/", "ListarContasReceber");
  console.log("\n=== RECEIVABLE — chaves do response ===", Object.keys(data));
  const arr = Object.values(data).find(v => Array.isArray(v));
  if (arr?.length > 0) {
    console.log("=== RECEIVABLE — chaves do 1º registro ===", Object.keys(arr[0]));
    console.log(JSON.stringify(arr[0], null, 2));
  }
} catch(e) { console.log("Receivables erro:", e.response?.data || e.message); }

// PAYABLES
try {
  const data = await callOmie("/financas/contapagar/", "ListarContasPagar");
  console.log("\n=== PAYABLE — chaves do response ===", Object.keys(data));
  const arr = Object.values(data).find(v => Array.isArray(v));
  if (arr?.length > 0) {
    console.log("=== PAYABLE — chaves do 1º registro ===", Object.keys(arr[0]));
    console.log(JSON.stringify(arr[0], null, 2));
  }
} catch(e) { console.log("Payables erro:", e.response?.data || e.message); }

// CUSTOMERS
try {
  const data = await callOmie("/geral/clientes/", "ListarClientes");
  console.log("\n=== CUSTOMER — chaves do response ===", Object.keys(data));
  const arr = Object.values(data).find(v => Array.isArray(v));
  if (arr?.length > 0) {
    console.log("=== CUSTOMER — chaves do 1º registro ===", Object.keys(arr[0]));
    console.log(JSON.stringify(arr[0], null, 2));
  }
} catch(e) { console.log("Customers erro:", e.response?.data || e.message); }
