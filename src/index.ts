import puppeteer from "@cloudflare/puppeteer";
import type { ExportedHandler } from "@cloudflare/workers-types";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function isRateLimitError(e: any) {
  const msg = (e?.message || String(e)).toLowerCase();
  return msg.includes("429") || msg.includes("rate limit");
}

function isFrameDetachedError(e: any) {
  const msg = (e?.message || String(e)).toLowerCase();
  return msg.includes("frame was detached") || msg.includes("detached");
}

export default {
  async fetch(request: Request, env: any) {
    const u = new URL(request.url);

    // ✅ Prevent extra browser launches from favicon requests
    if (u.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (u.pathname === "/health") return new Response("ok", { status: 200 });

    const targetUrl = u.searchParams.get("url") || "https://decevent.pages.dev/";
    const mode = (u.searchParams.get("mode") || "leaderboard").toLowerCase();
    const width = clamp(Number(u.searchParams.get("w") || 1200), 320, 2400);
    const height = clamp(Number(u.searchParams.get("h") || 900), 320, 4000);

    // Leaderboard selectors (from your Inspect screenshot)
    const selectors = [
      "section.leaderboard-card",
      ".leaderboard-card",
      ".leaderboard-body",
      "#rankingList",
    ];

    const attempt = async () => {
      let browser: any = null;

      try {
        // ✅ Handle rate limit nicely (instead of 1101)
        try {
          browser = await puppeteer.launch(env.BROWSER);
        } catch (e: any) {
          if (isRateLimitError(e)) {
            return new Response(
              "Browser Rendering rate-limited (429). Try again in 30–60 seconds.",
              { status: 429, headers: { "Content-Type": "text/plain" } }
            );
          }
          throw e;
        }

        const page = await browser.newPage();

        await page.setUserAgent(
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123 Safari/537.36"
        );

        await page.emulateMediaType("screen");

        await page.setViewport({
          width,
          height,
          deviceScaleFactor: 1,
        });

        // ✅ Don’t use networkidle0 (causes issues on live pages)
        await page.goto(targetUrl, { waitUntil: "domcontentloaded" });

        // ✅ Wait until the leaderboard exists (stable signal)
        let el: any = null;
        for (const sel of selectors) {
          try {
            el = await page.waitForSelector(sel, { timeout: 8000 });
            if (el) break;
          } catch {}
        }

        // Give SPA render / fonts time to settle
        await page.waitForTimeout(1200);

        // Freeze animations (optional but helps)
        await page.addStyleTag({
          content: `
            *, *::before, *::after { 
              animation: none !important; 
              transition: none !important; 
            }
          `,
        });

        // ✅ Full page mode (debug / fallback)
        if (mode === "full") {
          const png = (await page.screenshot({ type: "png", fullPage: true })) as Uint8Array;
          await browser.close();
          return new Response(png, {
            headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
          });
        }

        // ✅ Leaderboard element not found → return helpful error
        if (!el) {
          const png = (await page.screenshot({ type: "png", fullPage: true })) as Uint8Array;
          await browser.close();
          return new Response(png, {
            status: 500,
            headers: {
              "Content-Type": "image/png",
              "X-Debug": "Leaderboard selector not found on this URL. Use ?mode=full to inspect.",
              "Cache-Control": "no-store",
            },
          });
        }

        // ✅ Element screenshot (no top banner)
        const png = (await el.screenshot({ type: "png" })) as Uint8Array;
        await browser.close();

        return new Response(png, {
          headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
        });
      } catch (err: any) {
        try {
          if (browser) await browser.close();
        } catch {}

        const msg = err?.stack || err?.message || String(err);
        return new Response(
          `Worker error while screenshotting:\n${msg}\n\nTarget: ${targetUrl}\nMode: ${mode}`,
          { status: 500, headers: { "Content-Type": "text/plain" } }
        );
      }
    };

    // ✅ Retry once if "frame detached" happens (common on SPAs)
    const res1 = await attempt();
    if (res1.status >= 500 && res1.headers.get("Content-Type")?.includes("text/plain")) {
      // If it's clearly frame detached, retry
      // (We can't parse the body here easily without consuming it, so we just retry once always for 500 text/plain)
      // This is safe and cheap compared to repeated user refreshes.
      return await attempt();
    }
    return res1;
  },
} satisfies ExportedHandler;
