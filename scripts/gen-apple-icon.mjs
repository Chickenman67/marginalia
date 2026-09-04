// Generate PNG icons at the sizes iOS / Android / PWA manifest need.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2a2620"/>
      <stop offset="100%" stop-color="#1a1714"/>
    </linearGradient>
  </defs>
  <rect width="180" height="180" rx="38" fill="url(#bg)"/>
  <g stroke="#f6f3ec" stroke-width="9" stroke-linecap="round" fill="none">
    <line x1="56" y1="56" x2="124" y2="56"/>
    <line x1="56" y1="84" x2="124" y2="84"/>
    <line x1="56" y1="112" x2="100" y2="112"/>
  </g>
  <circle cx="116" cy="128" r="22" fill="#b4542f"/>
  <path d="M104 128 l8 8 l16 -18" stroke="#f6f3ec" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const targets = [
  { name: "apple-touch-icon.png", size: 180 },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 }
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  await page.setContent(`<!doctype html><meta name="viewport" content="width=${t.size}"><style>html,body{margin:0;padding:0;width:${t.size}px;height:${t.size}px;background:transparent}svg{display:block;width:${t.size}px;height:${t.size}px}</style>${svg}`);
  await page.waitForTimeout(120);
  const buf = await page.locator("svg").screenshot({ omitBackground: true });
  writeFileSync(`public/${t.name}`, buf);
  console.log(`Wrote public/${t.name}`, buf.length, "bytes");
}
await browser.close();

