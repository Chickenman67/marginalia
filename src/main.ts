import "./style.css";
import { isDemoMode } from "./config";
import { loadItems, subscribeRealtime, subscribe, deleteOldEvents } from "./store";
import { getSettings } from "./settings";
import { mountHeader } from "./ui/header";
import { mountInput, mountViews } from "./ui/input";
import { fireNotifications, resetNotified } from "./reminders";
import type { Item } from "./types";

async function boot() {
  mountHeader();
  mountInput();
  mountViews();

  const note = document.querySelector(".demo-note");
  if (isDemoMode && note) note.textContent = "Demo mode — add VITE_SUPABASE_URL to enable sync.";
  if (!isDemoMode) note?.remove();

  await loadItems();
  await subscribeRealtime();

  const runAutoDelete = () => {
    const s = getSettings();
    if (s.autoDelete) deleteOldEvents(s.autoDeleteDays);
  };
  runAutoDelete();
  setInterval(runAutoDelete, 5 * 60 * 1000);

  // Keep the list clear of the fixed dock, which grows when dictation/draft panels open.
  const dock = document.querySelector<HTMLElement>(".dock");
  const main = document.querySelector<HTMLElement>("main");
  if (dock && main) {
    const fit = () => { main.style.paddingBottom = `${dock.offsetHeight + 24}px`; };
    fit();
    new ResizeObserver(fit).observe(dock);
    window.addEventListener("resize", fit);
  }

  // Seed the notified-set so we don't notify for items already due at load.
  subscribe((items: Item[]) => resetNotified(items.map((i) => i.id)));

  // Poll every 30s: surface newly-due items + fire browser notifications if enabled.
  setInterval(() => {
    subscribe((items: Item[]) => {
      fireNotifications(items);
    });
  }, 30000);
}

boot();
