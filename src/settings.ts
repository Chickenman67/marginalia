import { fetchProfile, updateProfile, invalidateProfileCache } from "./supabase";
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
  pastDueColor: string;
  llmKey?: string;
  llmProvider?: string;
  showDeleted: boolean;
  deletedAutoCleanupDays: number;
}

let cache: Settings | null = null;

// Drop the legacy Overdue rule and any rule with a 0/negative window, then
// dedupe by withinHours keeping the LAST rule at each window. Used by both
// loadSettings (to clean profiles saved before the past-due separation) and
// the Save handler (to keep user profiles tidy).
export function cleanColorRules(rules: ColorRule[]): ColorRule[] {
  const filtered = rules.filter((r) => r.id !== "r-overdue" && r.withinHours > 0);
  const byHours = new Map<number, ColorRule>();
  for (const r of filtered) byHours.set(r.withinHours, r);
  return [...byHours.values()];
}

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
      colorRules: cleanColorRules(p.color_rules ?? []),
      browserNotifications: typeof Notification !== "undefined" && Notification.permission === "granted",
      dueIncludeOverdue: p.due_include_overdue ?? true,
      dueDaysAhead: p.due_days_ahead ?? 7,
      pastDueColor: p.past_due_color ?? defaults().pastDueColor,
      llmKey: p.llm_key ?? undefined,
      llmProvider: p.llm_provider ?? "nvidia",
      showDeleted: p.show_deleted ?? true,
      deletedAutoCleanupDays: p.deleted_auto_cleanup_days ?? 30
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
    dueDaysAhead: 7,
    pastDueColor: "#b4452f",
    showDeleted: true,
    deletedAutoCleanupDays: 30
  };
}

export function getSettings(): Settings {
  return cache ?? defaults();
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  cache = { ...getSettings(), ...patch };
  notifyListeners();
  const session = await getSession();
  if (!session) {
    if (patch.llmKey !== undefined) localStorage.setItem(STORAGE_KEYS.llmKey, patch.llmKey);
    if (patch.llmProvider !== undefined) localStorage.setItem(STORAGE_KEYS.provider, patch.llmProvider);
    return;
  }
  const map: Record<string, any> = {
    autoRemindEvents: "auto_remind_events",
    militaryTime: "military_time",
    autoDelete: "auto_delete",
    autoDeleteDays: "auto_delete_days",
    colorRules: "color_rules",
    dueIncludeOverdue: "due_include_overdue",
    dueDaysAhead: "due_days_ahead",
    pastDueColor: "past_due_color",
    llmKey: "llm_key",
    llmProvider: "llm_provider",
    showDeleted: "show_deleted",
    deletedAutoCleanupDays: "deleted_auto_cleanup_days"
  };
  const profilePatch: Record<string, any> = {};
  for (const [k, v] of Object.entries(patch)) {
    const col = map[k];
    if (col) profilePatch[col] = v;
  }
  if (Object.keys(profilePatch).length) {
    await updateProfile(session.user.id, profilePatch);
  }
  invalidateProfileCache();
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
//
// Past-date items (yesterday or earlier by calendar date) always get
// `settings.pastDueColor`. Items with today's calendar date — even if their
// specific clock time has already passed — get the Today rule, matching the
// user's mental model that "Today group = Today color." Future items fall
// through to the hours-based rule ladder; items beyond all rules return
// FAR_FUTURE_COLOR.
export function colorFor(iso: string | null): string | null {
  if (!iso) return null;
  const due = new Date(iso);
  if (isNaN(due.getTime())) return null;
  const now = new Date();
  const dueMs = due.getTime();
  const nowMs = now.getTime();
  const isSameDay =
    due.getFullYear() === now.getFullYear() &&
    due.getMonth() === now.getMonth() &&
    due.getDate() === now.getDate();
  if (!isSameDay && dueMs < nowMs) {
    return getSettings().pastDueColor;
  }
  const hours = (dueMs - nowMs) / 3.6e6;
  const s = getSettings();
  const sorted = [...s.colorRules].sort((a, b) => a.withinHours - b.withinHours);
  for (const r of sorted) {
    if (hours <= r.withinHours) return r.color;
  }
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