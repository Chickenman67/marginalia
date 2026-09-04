import { fetchProfile, updateProfile } from "./supabase";
import { getSession } from "./auth";
import { STORAGE_KEYS } from "./config";

export interface ColorRule {
  id: string;
  label: string;
  color: string;
  withinHours: number;
}

export interface Settings {
  autoRemindEvents: boolean;
  militaryTime: boolean;
  autoDelete: boolean;
  autoDeleteDays: number;
  colorRules: ColorRule[];
  browserNotifications: boolean;
  dueIncludeOverdue: boolean;
  dueDaysAhead: number;
}

let cache: Settings | null = null;

export async function loadSettings(): Promise<Settings> {
  const session = await getSession();
  if (!session) {
    cache = defaults();
    return cache;
  }
  try {
    const p = await fetchProfile(session.user.id);
    cache = {
      autoRemindEvents: p.auto_remind_events,
      militaryTime: p.military_time,
      autoDelete: p.auto_delete,
      autoDeleteDays: p.auto_delete_days,
      colorRules: p.color_rules ?? [],
      browserNotifications: typeof Notification !== "undefined" && Notification.permission === "granted",
      dueIncludeOverdue: p.due_include_overdue ?? true,
      dueDaysAhead: p.due_days_ahead ?? 7
    };
  } catch {
    cache = defaults();
  }
  return cache;
}

export function defaults(): Settings {
  return {
    autoRemindEvents: true,
    militaryTime: false,
    autoDelete: false,
    autoDeleteDays: 30,
    colorRules: [],
    browserNotifications: false,
    dueIncludeOverdue: true,
    dueDaysAhead: 7
  };
}

export function getSettings(): Settings {
  return cache ?? defaults();
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  cache = { ...getSettings(), ...patch };
  notifyListeners();
  const session = await getSession();
  if (!session) return;
  const map: Record<string, any> = {
    autoRemindEvents: "auto_remind_events",
    militaryTime: "military_time",
    autoDelete: "auto_delete",
    autoDeleteDays: "auto_delete_days",
    colorRules: "color_rules",
    dueIncludeOverdue: "due_include_overdue",
    dueDaysAhead: "due_days_ahead"
  };
  const profilePatch: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = map[k];
    if (col) profilePatch[col] = v;
  }
  if (Object.keys(profilePatch).length) {
    await updateProfile(session.user.id, profilePatch);
  }
}

export async function enableNotifications(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  if (Notification.permission === "granted") {
    updateSettings({ browserNotifications: true });
    return true;
  }
  const r = await Notification.requestPermission();
  const ok = r === "granted";
  updateSettings({ browserNotifications: ok });
  return ok;
}

// Re-export for the provider/key kept in localStorage.
export function getLlmKey(): string { return localStorage.getItem(STORAGE_KEYS.llmKey) || ""; }
export function getProvider(): string { return localStorage.getItem(STORAGE_KEYS.provider) || "nvidia"; }

// Color applied to future items that fall beyond every rule's window, so they
// are never left colorless.
export const FAR_FUTURE_COLOR = "#3f7d6e";

// Lets the views re-render live when a time/color setting changes.
type SettingsListener = (s: Settings) => void;
const settingsListeners = new Set<SettingsListener>();
export function subscribeSettings(fn: SettingsListener): () => void {
  settingsListeners.add(fn);
  return () => settingsListeners.delete(fn);
}

function notifyListeners() {
  settingsListeners.forEach((fn) => fn(cache!));
}

// Returns the hex color for an item due at `iso`, or null if no rule matches.
// For past items (hours < 0), the rule with the *largest* withinHours whose
// window we are still inside of wins. Rules with withinHours >= 0 are the
// "future" rules; for overdue items we keep returning the most-specific rule
// that already painted this item while it was still upcoming, so the color
// doesn't snap to "far future" the moment an item goes overdue.
export function colorFor(iso: string | null): string | null {
  if (!iso) return null;
  const due = new Date(iso).getTime();
  if (isNaN(due)) return null;
  const now = Date.now();
  const hours = (due - now) / 3.6e6;
  const s = getSettings();
  // Sort rules ascending by withinHours. For future items, the smallest window
  // that still contains the item wins (most specific). For past items, the
  // largest window whose boundary we have already crossed wins.
  const sorted = [...s.colorRules].sort((a, b) => a.withinHours - b.withinHours);
  let best: ColorRule | null = null;
  for (const r of sorted) {
    if (hours < 0) {
      if (r.withinHours >= Math.abs(hours)) best = r;
    } else {
      if (hours <= r.withinHours) best = r;
    }
  }
  if (best) return best.color;
  return FAR_FUTURE_COLOR;
}

// Formats an ISO datetime as a clock string honoring the user's 24h/military setting.
export function formatClock(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const s = getSettings();
  const opts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit", hour12: !s.militaryTime };
  return d.toLocaleTimeString(undefined, opts);
}

export function notificationsAllowed(): boolean {
  const s = getSettings();
  return (
    s.browserNotifications &&
    typeof Notification !== "undefined" &&
    Notification.permission === "granted"
  );
}

// Default starter set for the Colors tab. Seeded on first open only.
export const DEFAULT_COLOR_RULES: ColorRule[] = [
  { id: "r-overdue",  label: "Overdue",   color: "#b4452f", withinHours: 0 },
  { id: "r-today",    label: "Today",     color: "#d28c2a", withinHours: 24 },
  { id: "r-thisweek", label: "This week", color: "#3f7d6e", withinHours: 168 }
];

// Palette the "+ Add color rule" button cycles through so consecutive adds
// never produce the same color twice (until the palette is exhausted).
const ADD_RULE_PALETTE = ["#b4452f", "#d28c2a", "#3f7d6e", "#6c63ff", "#c64a8e", "#4a8ec6"];

export function nextColorForNewRule(existingColors: string[]): string {
  const used = new Set(existingColors.map((c) => c.toLowerCase()));
  for (const c of ADD_RULE_PALETTE) {
    if (!used.has(c.toLowerCase())) return c;
  }
  return ADD_RULE_PALETTE[0];
}