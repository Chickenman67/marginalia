import { isDemoMode } from "../config";
import { addItem, getSpaceToken, subscribe } from "../store";
import { parsePhrase } from "../supabase";
import { createSpeech } from "../speech";
import { cardHTML, bindCardEvents, groupByDay, esc } from "./views";
import { dueItems } from "../reminders";
function el(sel) { return document.querySelector(sel); }
let draft = null;
export function mountInput() {
    const phraseEl = el("#phrase");
    const preview = el("#preview");
    const previewText = el("#previewText");
    const micBtn = el("#mic");
    const hint = el("#hint");
    const speech = createSpeech();
    if (!speech.supported) {
        micBtn.disabled = true;
        micBtn.title = "Voice not supported here";
        hint.textContent = "Voice not supported in this browser — type instead (Enter to add)";
    }
    else {
        speech.onResult = (text) => { phraseEl.value = text; updatePreview(); };
        speech.onState = (l) => micBtn.classList.toggle("listening", l);
        micBtn.onclick = () => (micBtn.classList.contains("listening") ? speech.stop() : speech.start());
    }
    function updatePreview() {
        const text = phraseEl.value.trim();
        if (!text) {
            preview.classList.remove("show");
            draft = null;
            return;
        }
        draft = guess(text);
        previewText.textContent = `${draft.kind === "event" ? "📅" : "☑"} ${esc(draft.title)}${draft.datetime ? " · " + clock(draft.datetime) : ""}`;
        preview.classList.add("show");
    }
    phraseEl.addEventListener("input", updatePreview);
    phraseEl.addEventListener("keydown", (e) => { if (e.key === "Enter")
        commit(); });
    el("#previewX").onclick = () => { phraseEl.value = ""; preview.classList.remove("show"); draft = null; };
    async function commit() {
        const text = phraseEl.value.trim();
        if (!text)
            return;
        let parsed;
        try {
            parsed = await parsePhrase(text);
        }
        catch {
            parsed = draft || guess(text); // offline fallback keeps the app usable
        }
        await addItem(parsed, getSpaceToken());
        phraseEl.value = "";
        preview.classList.remove("show");
        draft = null;
    }
}
// Lightweight local guess so the UI is responsive before/without the LLM call.
function guess(text) {
    const lower = text.toLowerCase();
    const hasTime = /\d{1,2}(:\d{2})?\s*(am|pm)?|tomorrow|today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|next week|afternoon|morning|evening|lunch|dinner|noon|birthday/.test(lower);
    const kind = hasTime ? "event" : "todo";
    return {
        title: text.replace(/\b(tomorrow|today|at|on|my)\b/gi, "").trim().slice(0, 60) || text,
        kind,
        datetime: kind === "event" ? new Date().toISOString() : null,
        reminder: kind === "event" ? new Date().toISOString() : null
    };
}
function clock(dt) {
    if (!dt)
        return "";
    const d = new Date(dt);
    return isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}
export function mountViews() {
    const vSched = el("#view-schedule");
    const vTodo = el("#view-todos");
    const vDue = el("#view-due");
    const cSched = el("#cSched");
    const cTodo = el("#cTodo");
    const cDue = el("#cDue");
    document.querySelectorAll(".tab").forEach((t) => {
        t.onclick = () => {
            document.querySelectorAll(".tab").forEach((x) => x.setAttribute("aria-selected", "false"));
            t.setAttribute("aria-selected", "true");
            vSched.hidden = t.dataset.view !== "schedule";
            vTodo.hidden = t.dataset.view !== "todos";
            vDue.hidden = t.dataset.view !== "due";
        };
    });
    subscribe((items) => {
        const events = items.filter((i) => i.kind === "event").sort((a, b) => (a.datetime || "").localeCompare(b.datetime || ""));
        const todos = items.filter((i) => i.kind === "todo").sort((a, b) => (a.status === "done" ? 1 : 0) - (b.status === "done" ? 1 : 0));
        const due = dueItems(items);
        cSched.textContent = String(events.filter((i) => i.status !== "done").length || "");
        cTodo.textContent = String(todos.filter((i) => i.status !== "done").length || "");
        cDue.textContent = String(due.length || "");
        vSched.innerHTML = events.length ? groupByDay(events) : `<div class="empty">Nothing scheduled. Speak or type to add one.</div>`;
        vTodo.innerHTML = todos.length ? todos.map(cardHTML).join("") : `<div class="empty">No todos. Add one below.</div>`;
        vDue.innerHTML = due.length ? due.map(cardHTML).join("") : `<div class="empty">Nothing due right now.</div>`;
        bindCardEvents(vSched);
        bindCardEvents(vTodo);
        bindCardEvents(vDue);
    });
    void isDemoMode;
}
void addItem;
