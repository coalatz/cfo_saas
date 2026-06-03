import axios from "axios";

async function run() {
  const url = "https://app.omie.com.br/api/v1/produtos/pedido/";
  const payload = {
    app_key: "7712237287755",
    app_secret: "7640397bb7ade266da7119024ca2675d",
    call: "ListarPedidos",
    param: [
      {
        pagina: 1,
        registros_por_pagina: 50,
        apenas_importado_api: "N"
      }
    ]
  };

  try {
    console.log("Enviando requisição para Omie...");
    console.log(JSON.stringify(payload, null, 2));
    
    const response = await axios.post(url, payload, {
      headers: { "Content-Type": "application/json" }
    });
    
    console.log("Sucesso! Status:", response.status);
    console.log("Dados recebidos:");
    console.log(response.data);
  } catch (err: any) {
    console.error("Erro na requisição!");
    if (err.response) {
      console.error("Status:", err.response.status);
      console.error("Resposta da Omie:", JSON.stringify(err.response.data, null, 2));
    } else {
      console.error(err.message);
    }
  }
}

run();
