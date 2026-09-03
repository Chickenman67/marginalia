import { STORAGE_KEYS } from "../config";
import { getSettings, updateSettings, enableNotifications, type ColorRule } from "../settings";
import { testProviderKey, updateProfile } from "../supabase";
import { getSession, signOut } from "../auth";
import { esc } from "./views";
import { toCSV, toText, parseFile, applyImport, download } from "../backup";
import type { ImportRow } from "../backup";
import { getItems } from "../store";

export async function mountHeader(): Promise<void> {
  const emailEl = document.getElementById("userEmail")!;
  const userMenu = document.getElementById("userMenu")!;
  const pop = userMenu.querySelector<HTMLElement>(".user-menu-pop")!;
  const session = await getSession();
  emailEl.textContent = session?.user.email ?? "—";

  // Toggle dropdown on click
  userMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    pop.hidden = !pop.hidden;
  });
  document.addEventListener("click", () => { pop.hidden = true; });

  document.getElementById("userSignOut")!.addEventListener("click", async () => {
    await signOut();
  });
  document.getElementById("userSettings")!.addEventListener("click", () => {
    openSettings();
    pop.hidden = true;
  });

  // settings modal — copy existing tab/handlers from the current header.ts verbatim
  const back = document.getElementById("settingsModal")!;
  const tabStrip = back.querySelector<HTMLElement>(".tab-strip")!;
  const panels = Array.from(back.querySelectorAll<HTMLElement>(".spanel"));
  tabStrip.querySelectorAll<HTMLButtonElement>(".stab").forEach((t) => {
    t.onclick = () => {
      tabStrip.querySelectorAll(".stab").forEach((x) => x.setAttribute("aria-selected", "false"));
      t.setAttribute("aria-selected", "true");
      const name = t.dataset.tab!;
      panels.forEach((p) => (p.hidden = p.dataset.panel !== name));
    };
  });

  const apiKey = document.getElementById("apiKey") as HTMLInputElement;
  const provider = document.getElementById("provider") as HTMLSelectElement;
  const setAuto = document.getElementById("setAutoRemind") as HTMLInputElement;
  const setNotify = document.getElementById("setNotify") as HTMLInputElement;
  const setMilitary = document.getElementById("setMilitary") as HTMLInputElement;
  const keyStatus = document.getElementById("keyStatus") as HTMLSpanElement;
  const rulesHost = document.getElementById("colorRules") as HTMLDivElement;

  function renderRules(rules: ColorRule[]) {
    rulesHost.innerHTML = rules.map((r, idx) => `
      <div class="rule" data-idx="${idx}">
        <input type="color" class="rule-color" value="${r.color}" aria-label="Color" />
        <input class="rule-label" value="${esc(r.label)}" aria-label="Label" />
        <span class="rule-within">within</span>
        <input type="number" class="rule-hours" min="1" value="${r.withinHours}" aria-label="Hours" />
        <span class="rule-hours-unit">hrs</span>
        <button type="button" class="rule-del" title="Remove">✕</button>
      </div>`).join("");
    rulesHost.querySelectorAll<HTMLButtonElement>(".rule-del").forEach((b) => {
      b.onclick = () => {
        const i = +b.closest(".rule")!.getAttribute("data-idx")!;
        const next = rules.slice();
        next.splice(i, 1);
        renderRules(next);
      };
    });
  }
  const readRules = (): ColorRule[] =>
    Array.from(rulesHost.querySelectorAll<HTMLElement>(".rule")).map((row) => ({
      id: `r-${crypto.randomUUID().slice(0, 8)}`,
      label: (row.querySelector(".rule-label") as HTMLInputElement).value.trim() || "Untitled",
      color: (row.querySelector(".rule-color") as HTMLInputElement).value,
      withinHours: Math.max(1, Number((row.querySelector(".rule-hours") as HTMLInputElement).value) || 24)
    }));

  const openSettings = () => {
    const s = getSettings();
    apiKey.value = localStorage.getItem(STORAGE_KEYS.llmKey) || "";
    provider.value = localStorage.getItem(STORAGE_KEYS.provider) || "nvidia";
    setAuto.checked = s.autoRemindEvents;
    setMilitary.checked = s.militaryTime;
    setNotify.checked = s.browserNotifications && typeof Notification !== "undefined" && Notification.permission === "granted";
    (document.getElementById("setAutoDelete") as HTMLInputElement).checked = s.autoDelete;
    (document.getElementById("autoDeleteDays") as HTMLInputElement).value = String(s.autoDeleteDays);
    keyStatus.textContent = "";
    keyStatus.className = "key-status";
    renderRules(s.colorRules);
    back.classList.add("show");
  };
  document.getElementById("settingsBtn")!.addEventListener("click", openSettings);
  document.getElementById("settingsCancel")!.addEventListener("click", () => back.classList.remove("show"));
  document.getElementById("settingsSave")!.addEventListener("click", async () => {
    localStorage.setItem(STORAGE_KEYS.llmKey, apiKey.value.trim());
    localStorage.setItem(STORAGE_KEYS.provider, provider.value);
    const userId = (await getSession())!.user.id;
    await updateProfile(userId, {
      auto_remind_events: setAuto.checked,
      military_time: setMilitary.checked,
      color_rules: readRules(),
      auto_delete: (document.getElementById("setAutoDelete") as HTMLInputElement).checked,
      auto_delete_days: Math.max(1, Number((document.getElementById("autoDeleteDays") as HTMLInputElement).value) || 30),
      provider: provider.value
    });
    if (setNotify.checked) {
      await enableNotifications();
    } else {
      updateSettings({ browserNotifications: false });
    }
    back.classList.remove("show");
  });

  document.getElementById("addRule")!.addEventListener("click", () => {
    const cur = Array.from(rulesHost.querySelectorAll<HTMLElement>(".rule")).map((row) => ({
      id: `r-${crypto.randomUUID().slice(0, 8)}`,
      label: (row.querySelector(".rule-label") as HTMLInputElement).value,
      color: (row.querySelector(".rule-color") as HTMLInputElement).value,
      withinHours: Number((row.querySelector(".rule-hours") as HTMLInputElement).value) || 24
    }));
    cur.push({ id: `r-${crypto.randomUUID().slice(0, 8)}`, label: "New rule", color: "#3f7d6e", withinHours: 72 });
    renderRules(cur);
  });

  const testBtn = document.getElementById("keyTest")!;
  testBtn.addEventListener("click", async () => {
    const key = apiKey.value.trim();
    if (!key) { keyStatus.textContent = "Enter a key first."; keyStatus.className = "key-status bad"; return; }
    keyStatus.textContent = "Testing…";
    keyStatus.className = "key-status";
    const r = await testProviderKey(provider.value, key);
    keyStatus.textContent = r.message;
    keyStatus.className = `key-status ${r.ok ? "good" : "bad"}`;
  });

  // Backup
  const exportCsv = document.getElementById("exportCsv") as HTMLButtonElement;
  const exportText = document.getElementById("exportText") as HTMLButtonElement;
  const importFile = document.getElementById("importFile") as HTMLInputElement;
  const importMode = document.getElementById("importMode") as HTMLDivElement;
  const importMerge = document.getElementById("importMerge") as HTMLButtonElement;
  const importReplace = document.getElementById("importReplace") as HTMLButtonElement;
  const backupStatus = document.getElementById("backupStatus") as HTMLSpanElement;

  let pendingRows: ImportRow[] = [];
  exportCsv.addEventListener("click", () => download(toCSV(getItems()), "marginalia-schedule.csv", "text/csv"));
  exportText.addEventListener("click", () => download(toText(getItems()), "marginalia-schedule.txt", "text/plain"));
  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    const text = await file.text();
    pendingRows = parseFile(text);
    importFile.value = "";
    if (!pendingRows.length) {
      backupStatus.textContent = "No items found in that file.";
      backupStatus.className = "key-status bad";
      importMode.hidden = true;
      return;
    }
    backupStatus.textContent = `Found ${pendingRows.length} item(s). Merge or replace?`;
    backupStatus.className = "key-status";
    importMode.hidden = false;
  });
  const runImport = async (mode: "merge" | "replace") => {
    try {
      await applyImport(pendingRows, mode);
      backupStatus.textContent = `Imported ${pendingRows.length} item(s) (${mode}).`;
      backupStatus.className = "key-status good";
    } catch (e) {
      backupStatus.textContent = `Import failed: ${e instanceof Error ? e.message : "error"}`;
      backupStatus.className = "key-status bad";
    }
    importMode.hidden = true;
    pendingRows = [];
  };
  importMerge.addEventListener("click", () => runImport("merge"));
  importReplace.addEventListener("click", () => runImport("replace"));
}