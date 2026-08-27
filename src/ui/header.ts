import { isDemoMode, STORAGE_KEYS } from "../config";
import { getSpaceToken, setSpaceToken, splitToken, combineToken, genTokenPair } from "../store";
import { getSettings, updateSettings, enableNotifications } from "../settings";

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

  // populate from saved settings whenever the modal opens
  const openSettings = () => {
    const s = getSettings();
    apiKey.value = localStorage.getItem(STORAGE_KEYS.llmKey) || "";
    provider.value = localStorage.getItem(STORAGE_KEYS.provider) || "nvidia";
    setAuto.checked = s.autoRemindEvents;
    setNotify.checked = s.browserNotifications && typeof Notification !== "undefined" && Notification.permission === "granted";
    back.classList.add("show");
  };
  chip.addEventListener("dblclick", openSettings);
  document.getElementById("settingsBtn")!.addEventListener("click", openSettings);

  document.getElementById("settingsCancel")!.addEventListener("click", () => back.classList.remove("show"));
  document.getElementById("settingsSave")!.addEventListener("click", async () => {
    localStorage.setItem(STORAGE_KEYS.llmKey, apiKey.value.trim());
    localStorage.setItem(STORAGE_KEYS.provider, provider.value);
    updateSettings({ autoRemindEvents: setAuto.checked });
    if (setNotify.checked) {
      await enableNotifications();
    } else {
      updateSettings({ browserNotifications: false });
    }
    back.classList.remove("show");
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
