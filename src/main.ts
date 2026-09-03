import "./style.css";
import { loadItems, subscribeRealtime, subscribe, deleteOldEvents } from "./store";
import { getSettings, loadSettings } from "./settings";
import { mountHeader } from "./ui/header";
import { mountInput, mountViews } from "./ui/input";
import { fireNotifications, resetNotified } from "./reminders";
import { starSymbolHTML } from "./ui/views";
import type { Item } from "./types";
import { getSession, onAuthChange } from "./auth";
import { mountAuthScreen, unmountAuthScreen } from "./ui/authScreen";
import { fetchProfile } from "./supabase";

const authRoot = document.getElementById("authRoot")!;
const appRoot = document.getElementById("appRoot")!;

async function bootApp() {
  await loadSettings();

  document.body.insertAdjacentHTML("afterbegin", starSymbolHTML());
  mountHeader();
  mountInput();
  mountViews();

  const session = await getSession();
  if (session) {
    try { await fetchProfile(session.user.id); } catch { /* first run; trigger will create one */ }
  }
  await loadItems();
  await subscribeRealtime();

  const runAutoDelete = () => {
    const s = getSettings();
    if (s.autoDelete) deleteOldEvents(s.autoDeleteDays);
  };
  runAutoDelete();
  setInterval(runAutoDelete, 5 * 60 * 1000);

  const dock = document.querySelector<HTMLElement>(".dock");
  const main = document.querySelector<HTMLElement>("main");
  if (dock && main) {
    const fit = () => { main.style.paddingBottom = `${dock.offsetHeight + 24}px`; };
    fit();
    new ResizeObserver(fit).observe(dock);
    window.addEventListener("resize", fit);
  }

  subscribe((items: Item[]) => resetNotified(items.map((i) => i.id)));
  setInterval(() => subscribe((items: Item[]) => fireNotifications(items)), 30000);
}

function showAuth() {
  appRoot.hidden = true;
  authRoot.hidden = false;
  mountAuthScreen(authRoot);
}
function showApp() {
  unmountAuthScreen(authRoot);
  authRoot.hidden = true;
  appRoot.hidden = false;
  // location.reload would be heavier; instead, kick off a fresh boot.
  bootApp();
}

onAuthChange((session) => {
  if (session) showApp();
  else showAuth();
});