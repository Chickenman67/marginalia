// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mountHeader } from "../../src/ui/header";
import { getSession, signOut } from "../../src/auth";

vi.mock("../../src/auth", () => ({
  getSession: vi.fn(),
  signOut: vi.fn()
}));

vi.mock("../../src/settings", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../../src/settings")>();
  return { ...mod, updateSettings: vi.fn() };
});

describe("user menu header", () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <header>
        <div class="user-menu-wrap">
          <button class="user-menu" id="userMenu" aria-haspopup="true" aria-expanded="false">
            <span class="dot"></span><span id="userEmail">—</span>
          </button>
          <div class="user-menu-pop" role="menu" hidden>
            <button type="button" role="menuitem" id="userSettings">Settings</button>
            <button type="button" role="menuitem" id="userSignOut">Sign out</button>
          </div>
        </div>
        <button id="settingsBtn"></button>
      </header>
      <div id="settingsModal" hidden>
        <div class="tab-strip">
          <button class="stab" data-tab="general" aria-selected="true">General</button>
          <button class="stab" data-tab="colors" aria-selected="false">Colors</button>
          <button class="stab" data-tab="backup" aria-selected="false">Backup</button>
        </div>
        <section class="spanel" data-panel="general">
          <select id="provider"><option value="nvidia">nvidia</option></select>
          <input id="apiKey" />
          <input type="checkbox" id="setAutoRemind" />
          <input type="checkbox" id="setNotify" />
          <input type="checkbox" id="setMilitary" />
          <input type="checkbox" id="setAutoDelete" />
          <input type="number" id="autoDeleteDays" min="1" value="30" />
          <input type="checkbox" id="setDueIncludeOverdue" />
          <input type="number" id="setDueDaysAhead" min="1" value="7" />
          <span id="keyStatus" class="key-status"></span>
          <button id="keyTest" type="button"></button>
          <button id="settingsCancel" type="button"></button>
          <button id="settingsSave" type="button"></button>
        </section>
        <section class="spanel" data-panel="colors" hidden>
          <input type="color" id="pastDueColor" />
          <div id="colorRules"></div>
          <button id="addRule" type="button"></button>
        </section>
        <section class="spanel" data-panel="backup" hidden>
          <button id="exportCsv" type="button"></button>
          <button id="exportText" type="button"></button>
          <input type="file" id="importFile" />
          <div id="importMode" hidden>
            <button id="importMerge" type="button"></button>
            <button id="importReplace" type="button"></button>
          </div>
          <span id="backupStatus" class="key-status"></span>
        </section>
      </div>
    `;
  });

  it("renders the signed-in email", async () => {
    (getSession as any).mockResolvedValue({ user: { email: "alice@example.com" } });
    await mountHeader();
    // mountHeader is async; wait one tick
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("userEmail")!.textContent).toBe("alice@example.com");
  });

  it("calls signOut when the Sign out button is clicked", async () => {
    (getSession as any).mockResolvedValue({ user: { email: "x@y.z" } });
    (signOut as any).mockResolvedValue(undefined);
    await mountHeader();
    await new Promise((r) => setTimeout(r, 0));
    document.getElementById("userSignOut")!.click();
    expect(signOut).toHaveBeenCalled();
  });

  it("toggles the dropdown when the menu chip is clicked", async () => {
    (getSession as any).mockResolvedValue({ user: { email: "x@y.z" } });
    await mountHeader();
    await new Promise((r) => setTimeout(r, 0));
    const menu = document.getElementById("userMenu")!;
    const pop = menu.parentElement!.querySelector<HTMLElement>(".user-menu-pop")!;
    expect(pop.hidden).toBe(true);
    menu.click();
    expect(pop.hidden).toBe(false);
    expect(menu.getAttribute("aria-expanded")).toBe("true");
    menu.click();
    expect(pop.hidden).toBe(true);
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });

  it("opens settings from the user-menu popover", async () => {
    (getSession as any).mockResolvedValue({ user: { email: "x@y.z" } });
    await mountHeader();
    await new Promise((r) => setTimeout(r, 0));
    const menu = document.getElementById("userMenu")!;
    menu.click();
    const back = document.getElementById("settingsModal")!;
    document.getElementById("userSettings")!.click();
    expect(back.classList.contains("show")).toBe(true);
    expect(menu.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("settings modal dismiss", () => {
  it("closes when the backdrop is clicked", async () => {
    (getSession as any).mockResolvedValue(null);
    await mountHeader();
    const back = document.getElementById("settingsModal")!;
    const btn = document.getElementById("settingsBtn")!;
    btn.click();
    expect(back.classList.contains("show")).toBe(true);
    back.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(back.classList.contains("show")).toBe(false);
  });

  it("does not close when clicking inside the modal panel", async () => {
    (getSession as any).mockResolvedValue(null);
    await mountHeader();
    const back = document.getElementById("settingsModal")!;
    const panel = back.querySelector(".spanel")!;
    const btn = document.getElementById("settingsBtn")!;
    btn.click();
    expect(back.classList.contains("show")).toBe(true);
    panel.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(back.classList.contains("show")).toBe(true);
  });

  it("closes when Escape is pressed and modal is open", async () => {
    (getSession as any).mockResolvedValue(null);
    await mountHeader();
    const back = document.getElementById("settingsModal")!;
    const btn = document.getElementById("settingsBtn")!;
    btn.click();
    expect(back.classList.contains("show")).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(back.classList.contains("show")).toBe(false);
  });
});