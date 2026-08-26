export interface Settings {
  browserNotifications: boolean;
  autoRemindEvents: boolean;
}

const KEY = "marginalia.settings";

const defaults: Settings = {
  browserNotifications: false,
  autoRemindEvents: true
};

let current: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    return { ...defaults, ...JSON.parse(raw) };
  } catch {
    return { ...defaults };
  }
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  current = { ...current, ...patch };
  localStorage.setItem(KEY, JSON.stringify(current));
  return current;
}

export function notificationsAllowed(): boolean {
  return (
    current.browserNotifications &&
    typeof Notification !== "undefined" &&
    Notification.permission === "granted"
  );
}

// Request permission only when the user opts in; returns the resulting state.
export async function enableNotifications(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") {
    updateSettings({ browserNotifications: true });
    return true;
  }
  if (Notification.permission === "denied") return false;
  const result = await Notification.requestPermission();
  const ok = result === "granted";
  updateSettings({ browserNotifications: ok });
  return ok;
}
