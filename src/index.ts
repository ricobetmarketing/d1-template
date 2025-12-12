import puppeteer from "@cloudflare/puppeteer";
import type { ExportedHandler } from "@cloudflare/workers-types";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isRateLimitError(e: any) {
  const msg = (e?.message || String(e)).toLowerCase();
  return msg.includes("429") || msg.includes("rate limit");
}

export default {
  async fetch(request: Request, env: any) {
    const u = new URL(request.url);

    // Ignore favicon
    if (u.pathname === "/favicon.ico") return new Response(null, { status: 204 });

    // Only allow screenshots at /shot
    if (u.pathname !== "/shot") {
      return new Response("OK. Use /shot?key=YOUR_KEY", {
        headers: { "Content-Type": "text/plain" },
      });
    }

    // Require secret key
    const key = u.searchParams.get("key");
    if (key !== env.SCREENSHOT_KEY) {
      return new Response("Forbidden", { status: 403 });
    }

    const targetUrl = u.searchParams.get("url") || "https://decevent.pages.dev/";
    const mode = (u.searchParams.get("mode") || "leaderboard").toLowerCase();

    const width = clamp(Number(u.searchParams.get("w") || 1200), 320, 2400);
    const height = clamp(Number(u.searchParams.get("h") || 900), 320, 4000);

    // Cache to prevent repeated Chromium launches
    const cacheKey = new Request(u.toString(), request);
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    let browser: any;
    try {
      try {
        browser = await puppeteer.launch(env.BROWSER);
      } catch (e: any) {
        if (isRateLimitError(e)) {
          return new Response(
            "Browser Rendering rate-limited (429). Try again later with the SAME /shot URL (cache will help once one succeeds).",
            { status: 429, headers: { "Content-Type": "text/plain" } }
          );
        }
        throw e;
      }

      const page = await browser.newPage();
      await page.emulateMediaType("screen");
      await page.setViewport({ width, height, deviceScaleFactor: 1 });

      // Avoid networkidle0 for dynamic pages
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);

      // Freeze animations for stable capture
      await page.addStyleTag({
        content: `*,*::before,*::after{animation:none!important;transition:none!important;}`,
      });

      if (mode === "full") {
        const png = (await page.screenshot({ type: "png", fullPage: true })) as Uint8Array;
        await browser.close();

        const res = new Response(png, {
          headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=180" },
        });
        await cache.put(cacheKey, res.clone());
        return res;
      }

      // Leaderboard-only selector (from your Inspect)
      const el = await page.waitForSelector("section.leaderboard-card", { timeout: 15000 });
      const png = (await el!.screenshot({ type: "png" })) as Uint8Array;

      await browser.close();

      const res = new Response(png, {
        headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=180" },
      });
      await cache.put(cacheKey, res.clone());
      return res;
    } catch (err: any) {
      try { if (browser) await browser.close(); } catch {}
      const msg = err?.stack || err?.message || String(err);
      return new Response(`Worker error:\n${msg}`, {
        status: 500,
        headers: { "Content-Type": "text/plain" },
      });
    }
  },
} satisfies ExportedHandler;
