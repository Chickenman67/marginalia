import { isDemoMode, STORAGE_KEYS } from "../config";
import { getSpaceToken, setSpaceToken, splitToken, combineToken, genTokenPair } from "../store";
import { getSettings, updateSettings, enableNotifications, type ColorRule } from "../settings";
import { testProviderKey } from "../supabase";
import { esc } from "./views";

export function mountHeader(): void {
  const label = document.getElementById("spaceLabel")!;
  const chip = document.getElementById("spaceChip")!;
  const copy = document.getElementById("copyToken")!;
  label.textContent = getSpaceToken();

  copy.addEventListener("click", () => {
    navigator.clipboard?.writeText(getSpaceToken());
    copy.textContent = "copied";
    setTimeout(() => (copy.textContent = "copy"), 1200);
  });

  // settings modal
  const back = document.getElementById("settingsModal")!;
  const apiKey = document.getElementById("apiKey") as HTMLInputElement;
  const provider = document.getElementById("provider") as HTMLSelectElement;
  const setAuto = document.getElementById("setAutoRemind") as HTMLInputElement;
  const setNotify = document.getElementById("setNotify") as HTMLInputElement;
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

  // populate from saved settings whenever the modal opens
  const openSettings = () => {
    const s = getSettings();
    apiKey.value = localStorage.getItem(STORAGE_KEYS.llmKey) || "";
    provider.value = localStorage.getItem(STORAGE_KEYS.provider) || "nvidia";
    setAuto.checked = s.autoRemindEvents;
    setNotify.checked = s.browserNotifications && typeof Notification !== "undefined" && Notification.permission === "granted";
    keyStatus.textContent = "";
    keyStatus.className = "key-status";
    renderRules(s.colorRules);
    back.classList.add("show");
  };
  chip.addEventListener("dblclick", openSettings);
  document.getElementById("settingsBtn")!.addEventListener("click", openSettings);

  document.getElementById("settingsCancel")!.addEventListener("click", () => back.classList.remove("show"));
  document.getElementById("settingsSave")!.addEventListener("click", async () => {
    localStorage.setItem(STORAGE_KEYS.llmKey, apiKey.value.trim());
    localStorage.setItem(STORAGE_KEYS.provider, provider.value);
    updateSettings({ autoRemindEvents: setAuto.checked, colorRules: readRules() });
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

  // space management: single-click chip opens the token modal (copy / new / join)
  const tokenModal = document.getElementById("tokenModal")!;
  const tokenInput = document.getElementById("tokenInput") as HTMLInputElement;
  chip.addEventListener("click", () => {
    tokenInput.value = getSpaceToken();
    tokenModal.classList.add("show");
  });

  // first-run space modal (only meaningful when not demo + token unknown)
  if (!isDemoMode && !localStorage.getItem(STORAGE_KEYS.spaceToken)) {
    tokenModal.classList.add("show");
  }
  const go = () => {
    const v = tokenInput.value.trim();
    if (v) {
      const { id, secret } = splitToken(v);
      setSpaceToken(id, secret);
      label.textContent = v;
    }
    tokenModal.classList.remove("show");
    // Always reload: the Supabase client caches the x-space-token header at
    // creation, so a changed token requires a fresh client to take effect.
    location.reload();
  };
  document.getElementById("tokenGo")!.addEventListener("click", go);
  document.getElementById("tokenNew")!.addEventListener("click", () => {
    const { id, secret } = genTokenPair();
    setSpaceToken(id, secret);
    const fresh = combineToken(id, secret);
    label.textContent = fresh;
    tokenModal.classList.remove("show");
    location.reload();
  });
  // pressing Enter in the token field also joins
  tokenInput.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
}
