import puppeteer from "@cloudflare/puppeteer";
import type { ExportedHandler } from "@cloudflare/workers-types";

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export default {
  async fetch(request: Request, env: any) {
    const urlObj = new URL(request.url);

    // Default target (change if you want)
    const targetUrl =
      urlObj.searchParams.get("url") ||
      "https://decevent.pages.dev/";

    // Optional: choose what to capture
    //  - mode=leaderboard (default): only section.leaderboard-card
    //  - mode=full: full page screenshot
    const mode = (urlObj.searchParams.get("mode") || "leaderboard").toLowerCase();

    // Screenshot size (you can override with ?w=1200&h=630)
    const width = clamp(Number(urlObj.searchParams.get("w") || 1200), 320, 2400);
    const height = clamp(Number(urlObj.searchParams.get("h") || 800), 320, 4000);

    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();

    // Make sure backgrounds are rendered (important for dark UI)
    await page.emulateMediaType("screen");

    await page.setViewport({
      width,
      height,
      deviceScaleFactor: 1,
    });

    // Load the page
    await page.goto(targetUrl, { waitUntil: "networkidle0" });

    // Give time for animations/data rendering (snowflakes / timers / dynamic list)
    await page.waitForTimeout(1200);

    // OPTIONAL: stop CSS animations so screenshot looks stable
    await page.addStyleTag({
      content: `
        *, *::before, *::after { 
          animation: none !important; 
          transition: none !important; 
          caret-color: transparent !important;
        }
      `,
    });

    // If you only want the leaderboard section
    if (mode === "leaderboard") {
      // This selector matches your leaderboard section in the screenshot:
      // <section class="leaderboard-card">...</section>
      const el = await page.waitForSelector("section.leaderboard-card", {
        timeout: 15000,
      });

      if (!el) {
        await browser.close();
        return new Response(
          "Could not find section.leaderboard-card on the page",
          { status: 500 }
        );
      }

      // Screenshot only that element (no top banner/header)
      const png = (await el.screenshot({ type: "png" })) as Uint8Array;

      await browser.close();

      return new Response(png, {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "no-store",
        },
      });
    }

    // Otherwise full page screenshot
    const png = (await page.screenshot({
      type: "png",
      fullPage: true,
    })) as Uint8Array;

    await browser.close();

    return new Response(png, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "no-store",
      },
    });
  },
} satisfies ExportedHandler;
