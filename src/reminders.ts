import type { Item } from "./types";
import { getSettings, notificationsAllowed } from "./settings";

// Items that are "due" now: have a reminder time <= now and not done.
export function dueItems(items: Item[]): Item[] {
  const now = Date.now();
  const { autoRemindEvents } = getSettings();
  return items.filter((i) => {
    if (i.status === "done") return false;
    if (!i.reminder) return false;
    if (new Date(i.reminder).getTime() > now) return false;
    // when auto-remind is off, only items with an explicit reminder (not the event-default) surface
    if (!autoRemindEvents && i.reminder === i.datetime) return false;
    return true;
  });
}

// Fire a one-shot browser notification for newly-due items (only if enabled + permitted).
let notified = new Set<string>();
export function fireNotifications(items: Item[]): void {
  if (!notificationsAllowed()) return;
  for (const i of dueItems(items)) {
    if (notified.has(i.id)) continue;
    notified.add(i.id);
    new Notification("Marginalia", { body: i.title });
  }
}
export function resetNotified(ids: string[]): void {
  notified = new Set(ids);
}
