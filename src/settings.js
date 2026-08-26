const KEY = "marginalia.settings";
const defaults = {
    browserNotifications: false,
    autoRemindEvents: true
};
let current = load();
function load() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw)
            return { ...defaults };
        return { ...defaults, ...JSON.parse(raw) };
    }
    catch {
        return { ...defaults };
    }
}
export function getSettings() {
    return current;
}
export function updateSettings(patch) {
    current = { ...current, ...patch };
    localStorage.setItem(KEY, JSON.stringify(current));
    return current;
}
export function notificationsAllowed() {
    return (current.browserNotifications &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted");
}
// Request permission only when the user opts in; returns the resulting state.
export async function enableNotifications() {
    if (typeof Notification === "undefined")
        return false;
    if (Notification.permission === "granted") {
        updateSettings({ browserNotifications: true });
        return true;
    }
    if (Notification.permission === "denied")
        return false;
    const result = await Notification.requestPermission();
    const ok = result === "granted";
    updateSettings({ browserNotifications: ok });
    return ok;
}
