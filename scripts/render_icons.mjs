// Renders the Home Screen and manifest PNGs from public/icons/icon.svg.
// Run from the repo root after changing the mark: node scripts/render_icons.mjs
// Uses the frontend lockfile's Playwright; PW_CHROMIUM_PATH may select a Chromium.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(new URL("../src/accanto/web/frontend/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const directory = new URL("../src/accanto/web/frontend/public/icons/", import.meta.url);
const svg = await readFile(new URL("icon.svg", directory), "utf8");
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM_PATH || undefined });
try {
  for (const [file, size] of [
    ["apple-touch-icon.png", 180],
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["icon-maskable-512.png", 512],
  ]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(
      `<style>html,body{margin:0}svg{width:100%;height:100%;display:block}</style>${svg}`,
    );
    await page.screenshot({ path: fileURLToPath(new URL(file, directory)) });
    await page.close();
  }
} finally {
  await browser.close();
}
