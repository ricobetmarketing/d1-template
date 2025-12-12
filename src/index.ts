import puppeteer from "@cloudflare/puppeteer";
import type { ExportedHandler } from "@cloudflare/workers-types";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default {
  async fetch(request: Request, env: any) {
    const u = new URL(request.url);

    const targetUrl = u.searchParams.get("url") || "https://decevent.pages.dev/";
    const mode = (u.searchParams.get("mode") || "leaderboard").toLowerCase();
    const debug = u.searchParams.get("debug") === "1";

    const width = clamp(Number(u.searchParams.get("w") || 1200), 320, 2400);
    const height = clamp(Number(u.searchParams.get("h") || 800), 320, 4000);

    let browser: any;

    try {
      browser = await puppeteer.launch(env.BROWSER);
      const page = await browser.newPage();

      // Helps some sites render more consistently
      await page.setUserAgent(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
      );

      await page.emulateMediaType("screen");

      await page.setViewport({ width, height, deviceScaleFactor: 1 });

      await page.goto(targetUrl, { waitUntil: "networkidle0" });

      // Give SPA / animations / data time to render
      await page.waitForTimeout(1500);

      // Optional: freeze animations so screenshot is stable
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation: none !important;
            transition: none !important;
          }
        `,
      });

      // FULL PAGE MODE (debug-friendly)
      if (mode === "full") {
        const png = (await page.screenshot({ type: "png", fullPage: true })) as Uint8Array;
        await browser.close();
        return new Response(png, {
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
        });
      }

      // LEADERBOARD MODE (element screenshot)
      // Try a few selectors (because Pages.dev and GitHub pages might differ slightly)
      const selectors = [
        "section.leaderboard-card",
        ".leaderboard-card",
        ".leaderboard-body",
        "#rankingList",
      ];

      let el: any = null;
      for (const sel of selectors) {
        el = await page.$(sel);
        if (el) break;
      }

      // If not found, return a full-page screenshot + helpful error (instead of 1101)
      if (!el) {
        const png = (await page.screenshot({ type: "png", fullPage: true })) as Uint8Array;
        await browser.close();

        if (!debug) {
          return new Response(
            "Leaderboard element not found. Try ?debug=1 or ?mode=full",
            { status: 500, headers: { "Content-Type": "text/plain" } }
          );
        }

        // Debug mode: return screenshot as PNG still, but with a header hint
        return new Response(png, {
          headers: {
            "Content-Type": "image/png",
            "X-Debug": "Leaderboard selector not found. Inspect DOM and set correct selector.",
            "Cache-Control": "no-store",
          },
        });
      }

      const png = (await el.screenshot({ type: "png" })) as Uint8Array;
      await browser.close();

      return new Response(png, {
        headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
      });
    } catch (err: any) {
      try {
        if (browser) await browser.close();
      } catch {}

      const msg =
        (err && (err.stack || err.message)) || "Unknown error";

      return new Response(
        `Worker error while screenshotting:\n${msg}\n\nTarget: ${targetUrl}\nMode: ${mode}`,
        { status: 500, headers: { "Content-Type": "text/plain" } }
      );
    }
  },
} satisfies ExportedHandler;
