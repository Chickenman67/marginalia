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
      browserNotifications: typeof Notification !== "undefined" && Notification.permission === "granted"
    };
  } catch {
    cache = defaults();
  }
  return cache;
}

function defaults(): Settings {
  return {
    autoRemindEvents: true,
    militaryTime: false,
    autoDelete: false,
    autoDeleteDays: 30,
    colorRules: [],
    browserNotifications: false
  };
}

export function getSettings(): Settings {
  return cache ?? defaults();
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  cache = { ...getSettings(), ...patch };
  const session = await getSession();
  if (!session) return;
  const map: Record<string, any> = {
    autoRemindEvents: "auto_remind_events",
    militaryTime: "military_time",
    autoDelete: "auto_delete",
    autoDeleteDays: "auto_delete_days",
    colorRules: "color_rules"
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