// Final shoot: cover desktop, iPhone 14, iPad, both with and without content.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const bust = Date.now();
const url = `http://localhost:5173/?t=${bust}`;
const storage = "C:\\Users\\<you>\\.config\\opencode\\todoapp-agent-storage.json";
const outDir = "C:\\Users\\<you>\\AppData\\Local\\Temp\\opencode\\final";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ storageState: storage });

  const captures = [
    { name: "desktop-1280", w: 1280, h: 900 },
    { name: "iphone-14", w: 390, h: 844 }
  ];

  for (const c of captures) {
    const page = await ctx.newPage();
    await page.setViewportSize({ width: c.w, height: c.h });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);

    // Debug: report element widths
    const widths = await page.evaluate(() => {
      const a = document.querySelector(".app");
      const m = document.querySelector("main");
      const d = document.querySelector(".dock-inner");
      return {
        vp: innerWidth,
        app: a ? Math.round(a.getBoundingClientRect().width) : 0,
        main: m ? Math.round(m.getBoundingClientRect().width) : 0,
        dock: d ? Math.round(d.getBoundingClientRect().width) : 0,
      };
    });
    console.log(`${c.name}: vp=${widths.vp} app=${widths.app} main=${widths.main} dock=${widths.dock}`);

    // Empty
    await page.screenshot({ path: `${outDir}/${c.name}-empty.png`, fullPage: true });

    // Add 2 events
    await page.fill("#phrase", "Buy groceries tomorrow 5pm");
    await page.click("#quickAdd");
    await page.waitForTimeout(700);
    await page.fill("#phrase", "Doctor appointment Tuesday 9am");
    await page.click("#quickAdd");
    await page.waitForTimeout(700);

    // Add a todo
    await page.fill("#phrase", "Pay electricity bill");
    await page.click("#quickAdd");
    await page.waitForTimeout(700);

    // Schedule with content
    await page.click('.tab[data-view="schedule"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/${c.name}-schedule.png`, fullPage: true });

    // Todos view (for big-card verification)
    await page.click('.tab[data-view="todos"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/${c.name}-todos.png`, fullPage: true });

    // Due view (for default-week verification)
    await page.click('.tab[data-view="due"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/${c.name}-due.png`, fullPage: true });

    // Dictate
    if (c.w >= 768) {
      const toggle = await page.$("#dictateToggle");
      if (toggle) {
        await page.click('.tab[data-view="schedule"]');
        await page.waitForTimeout(200);
        await toggle.click();
        await page.waitForTimeout(300);
        await page.screenshot({ path: `${outDir}/${c.name}-dictate.png`, fullPage: false });
      }
    }

    // Settings (General tab — default)
    await page.click("#settingsBtn");
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/${c.name}-settings.png`, fullPage: false });

    // Settings → Colors (for default-rules verification)
    await page.click('.stab[data-tab="colors"]');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/${c.name}-colors.png`, fullPage: false });

    // Backdrop dismiss — click on the backdrop, verify modal closes
    await page.mouse.click(20, 20);
    await page.waitForTimeout(200);
    const stillOpen = await page.evaluate(() => document.getElementById("settingsModal")?.classList.contains("show"));
    console.log(`${c.name}: backdrop dismiss closed modal: ${!stillOpen}`);

    await page.close();
  }

  console.log("OK");
} finally {
  await browser.close();
}
