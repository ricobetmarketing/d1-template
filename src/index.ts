import puppeteer from "@cloudflare/puppeteer";
import type { ExportedHandler } from "@cloudflare/workers-types";

export default {
  async fetch(request: Request, env: any) {
    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();

    await page.setViewport({
      width: 1200,
      height: 630,
      deviceScaleFactor: 1,
    });

    await page.goto("https://rico-quest-cloudflare.pages.dev/", {
      waitUntil: "networkidle0",
    });

    const screenshot = await page.screenshot({ type: "png" });

    await browser.close();

    return new Response(screenshot, {
      headers: {
        "Content-Type": "image/png",
      },
    });
  },
} satisfies ExportedHandler;
