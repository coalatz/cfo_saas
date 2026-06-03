import { fetchDocumentation } from "../server/docFetcher";

async function main() {
  const docUrl = "https://developer.omie.com.br/service-list/";
  console.log(`Fetching ${docUrl}...`);
  const result = await fetchDocumentation(docUrl);
  console.log(`Total chars: ${result.combinedText.length}`);
  console.log(`Number of pages: ${result.pages.length}`);
  for (const page of result.pages) {
    console.log(`- ${page.url}`);
  }
  
  const text = result.combinedText.toLowerCase();
  console.log("Contains contareceber?", text.includes("contareceber"));
  console.log("Contains contas_receber?", text.includes("contas_receber"));
  console.log("Contains produtos/pedido?", text.includes("produtos/pedido"));
}

main().catch(console.error);
