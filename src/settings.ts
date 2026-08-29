export interface ColorRule {
  id: string;
  label: string;
  color: string; // hex
  withinHours: number; // due within this many hours from now
}

export interface Settings {
  browserNotifications: boolean;
  autoRemindEvents: boolean;
  militaryTime: boolean;
  colorRules: ColorRule[];
  autoDelete: boolean;
  autoDeleteDays: number;
}

const KEY = "marginalia.settings";

const defaultRules: ColorRule[] = [
  { id: "r-today", label: "Due today", color: "#b4452f", withinHours: 24 },
  { id: "r-tomorrow", label: "Due tomorrow", color: "#2f6fb4", withinHours: 48 },
  { id: "r-week", label: "Due this week", color: "#b4892f", withinHours: 168 }
];

// Color applied to future items that fall beyond every rule's window, so they
// are never left colorless.
export const FAR_FUTURE_COLOR = "#3f7d6e";

const defaults: Settings = {
  browserNotifications: false,
  autoRemindEvents: true,
  militaryTime: false,
  colorRules: defaultRules,
  autoDelete: false,
  autoDeleteDays: 30
};

let current: Settings = load();

function load(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed,
      colorRules: Array.isArray(parsed.colorRules) && parsed.colorRules.length ? parsed.colorRules : defaults.colorRules
    };
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
  settingsListeners.forEach((fn) => fn(current));
  return current;
}

// Lets the views re-render live when a time/color setting changes.
type SettingsListener = (s: Settings) => void;
const settingsListeners = new Set<SettingsListener>();
export function subscribeSettings(fn: SettingsListener): () => void {
  settingsListeners.add(fn);
  return () => settingsListeners.delete(fn);
}

// Returns the hex color for an item due at `iso`, or null if no rule matches.
export function colorFor(iso: string | null): string | null {
  if (!iso) return null;
  const due = new Date(iso).getTime();
  if (isNaN(due)) return null;
  const now = Date.now();
  const hours = (due - now) / 3.6e6;
  if (hours < 0) return null; // past due uses default styling
  // smallest withinHours that still covers the item wins (most specific)
  let best: ColorRule | null = null;
  for (const r of current.colorRules) {
    if (hours <= r.withinHours && (!best || r.withinHours < best.withinHours)) best = r;
  }
  if (best) return best.color;
  // No rule matched but the item is still in the future: give it a steady color
  // instead of leaving it colorless.
  return FAR_FUTURE_COLOR;
}

// Formats an ISO datetime as a clock string honoring the user's 24h/military setting.
export function formatClock(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: !current.militaryTime };
  return d.toLocaleTimeString(undefined, opts);
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
