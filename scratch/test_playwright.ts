import { chromium } from "playwright";
import * as cheerio from "cheerio";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto("https://app.omie.com.br/api/v1/financas/resumo/", { waitUntil: 'networkidle', timeout: 30000 });
  const html = await page.content();
  await browser.close();

  const $ = cheerio.load(html);
  const links: string[] = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (href && !links.includes(href)) {
      links.push(href);
    }
  });
  
  console.log("Total links found:", links.length);
  console.log("Sample links:", links.slice(0, 30));
}
main().catch(console.error);
