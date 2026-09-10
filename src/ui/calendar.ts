// Theme-matched calendar + time popover used by the manual Schedule entry form.
// Mounts a popover next to a trigger button; calls onPicked with "YYYY-MM-DD" / "HH:MM".

let openPop: HTMLElement | null = null;
let popTrack: (() => void) | null = null;

function closePop() {
  if (openPop) {
    openPop.remove();
    openPop = null;
    document.removeEventListener("keydown", onEsc);
    document.removeEventListener("click", onDocClick, true);
    if (popTrack) {
      window.removeEventListener("resize", popTrack);
      window.removeEventListener("scroll", popTrack, true);
      popTrack = null;
    }
  }
}
function onEsc(e: KeyboardEvent) { if (e.key === "Escape") closePop(); }
function onDocClick(e: MouseEvent) {
  if (openPop && !openPop.contains(e.target as Node) && !(e.target as HTMLElement).closest(".picker-trigger")) {
    closePop();
  }
}

function mountPop(trigger: HTMLElement, pop: HTMLElement) {
  closePop();
  pop.classList.add("pop");
  document.body.appendChild(pop);
  positionPop(trigger, pop);
  openPop = pop;
  // Keep the popover anchored to its trigger as the page resizes/scrolls so a
  // shorter month can't leave it stranded or shrunken against the wrong spot.
  popTrack = () => positionPop(trigger, pop);
  window.addEventListener("resize", popTrack);
  window.addEventListener("scroll", popTrack, true);
  setTimeout(() => {
    document.addEventListener("keydown", onEsc);
    document.addEventListener("click", onDocClick, true);
  }, 0);
}

// Re-anchor the popover after content changes (e.g. month/year switch) so a
// shorter month can't leave the fixed dock gradient showing through underneath.
function positionPop(trigger: HTMLElement, pop: HTMLElement) {
  const r = trigger.getBoundingClientRect();
  pop.style.top = `${Math.min(window.innerHeight - pop.offsetHeight - 8, Math.max(8, r.bottom + 6))}px`;
  pop.style.left = `${Math.min(Math.max(8, r.left), window.innerWidth - pop.offsetWidth - 8)}px`;
}

// Build a generous year window centered on `center` so the picker starts with
// plenty of range; extendYears() keeps adding options at the edges on demand.
function yearOptions(center: number): string[] {
  const out: string[] = [];
  for (let i = center - 60; i <= center + 60; i++) out.push(`<option value="${i}">${i}</option>`);
  return out;
}
function extendYears(sel: HTMLSelectElement, picked: number): void {
  const opts = Array.from(sel.options).map((o) => Number(o.value));
  const min = Math.min(...opts);
  const max = Math.max(...opts);
  const frag = document.createDocumentFragment();
  if (picked <= min + 10) {
    for (let i = min - 30; i < min; i++) {
      const o = document.createElement("option");
      o.value = String(i); o.textContent = String(i);
      frag.appendChild(o);
    }
    sel.insertBefore(frag, sel.firstChild);
  } else if (picked >= max - 10) {
    for (let i = max + 1; i <= max + 30; i++) {
      const o = document.createElement("option");
      o.value = String(i); o.textContent = String(i);
      frag.appendChild(o);
    }
    sel.appendChild(frag);
  }
}

export function openCalendar(trigger: HTMLElement, initial: string, onPicked: (isoDate: string) => void) {
  const pop = document.createElement("div");
  let view = initial ? new Date(initial + "T00:00:00") : new Date();
  view = new Date(view.getFullYear(), view.getMonth(), 1);
  const sel = initial;

  const render = () => {
    const y = view.getFullYear();
    const m = view.getMonth();
    const first = new Date(y, m, 1).getDay();
    const days = new Date(y, m + 1, 0).getDate();
    // A wide initial window; the select also extends itself when you reach an
    // edge, so there is effectively no limit on how far back/forward you can go.
    const years: string[] = yearOptions(y);
    let cells = "";
    for (let i = 0; i < first; i++) cells += `<span class="pop-day empty"></span>`;
    for (let d = 1; d <= days; d++) {
      const iso = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      const cls = iso === sel ? "pop-day sel" : "pop-day";
      cells += `<button type="button" class="${cls}" data-iso="${iso}">${d}</button>`;
    }
    pop.innerHTML = `
      <div class="pop-head">
        <button type="button" class="pop-nav" data-dir="-1" aria-label="Previous month">‹</button>
        <select class="pop-month" aria-label="Month">${["January","February","March","April","May","June","July","August","September","October","November","December"].map((nm, i) => `<option value="${i}" ${i === m ? "selected" : ""}>${nm}</option>`).join("")}</select>
        <button type="button" class="pop-nav" data-dir="1" aria-label="Next month">›</button>
      </div>
      <div class="pop-head pop-yearrow">
        <select class="pop-year" aria-label="Year">${years.join("")}</select>
      </div>
      <div class="pop-grid">
        ${["S", "M", "T", "W", "T", "F", "S"].map((w) => `<span class="pop-wk">${w}</span>`).join("")}
        ${cells}
      </div>`;
    pop.querySelectorAll<HTMLButtonElement>(".pop-nav").forEach((b) =>
      (b.onclick = (e) => { e.stopPropagation(); view = new Date(y, m + Number(b.dataset.dir), 1); render(); })
    );
    pop.querySelector<HTMLSelectElement>(".pop-month")!.onchange = (e) => {
      e.stopPropagation();
      view = new Date(y, Number((e.target as HTMLSelectElement).value), 1);
      render();
    };
    const yearSel = pop.querySelector<HTMLSelectElement>(".pop-year")!;
    yearSel.value = String(y);
    yearSel.onchange = (e) => {
      e.stopPropagation();
      const v = Number((e.target as HTMLSelectElement).value);
      view = new Date(v, m, 1);
      render();
      // Extend the list when the user scrolls to either end so years are endless.
      extendYears(yearSel, v);
    };
    pop.querySelectorAll<HTMLButtonElement>(".pop-day:not(.empty)").forEach((b) =>
      (b.onclick = (e) => { e.stopPropagation(); onPicked(b.dataset.iso!); closePop(); })
    );
    positionPop(trigger, pop);
  };
  render();
  mountPop(trigger, pop);
}

export function openTimePicker(trigger: HTMLElement, initial: string, onPicked: (hhmm: string) => void) {
  const pop = document.createElement("div");
  const military = (window as any).__marginaliaMilitary === true;
  let h = 9, m = 0;
  if (/^\d{2}:\d{2}$/.test(initial)) { h = Number(initial.slice(0, 2)); m = Number(initial.slice(3, 5)); }
  // In 12h mode track the 0..11 hour index + meridiem separately to avoid off-by-one bugs.
  let pm = h >= 12;
  let h12 = (h + 11) % 12; // 0 => 12, 1 => 1, ... 11 => 11
  const to24 = () => military ? h : (((h12 + 1) % 12) + (pm ? 12 : 0));
  const readout = () => {
    const ro = pop.querySelector<HTMLElement>(".time-read");
    if (!ro) return;
    if (military) {
      ro.textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    } else {
      const disp = h12 + 1;
      ro.textContent = `${String(disp).padStart(2, "0")}:${String(m).padStart(2, "0")} ${pm ? "PM" : "AM"}`;
    }
  };
  // Looping wheel: render the value sequence many times so scrolling never hits an end.
  const buildWheel = (host: HTMLElement, count: number, cur: number, loopCount: number, label: (v: number) => string, onPick: (v: number) => void) => {
    const padN = 3;
    const total = count * loopCount;
    let html = "";
    for (let i = 0; i < padN; i++) html += `<div class="wheel-pad"></div>`;
    for (let i = 0; i < total; i++) {
      const v = i % count;
      const cls = "wheel-item" + (v === cur ? " sel" : "");
      html += `<button type="button" class="${cls}" data-v="${v}">${label(v)}</button>`;
    }
    for (let i = 0; i < padN; i++) html += `<div class="wheel-pad"></div>`;
    host.innerHTML = html;
    const item = () => host.querySelector<HTMLElement>(".wheel-item")!;
    const rowH = () => item().offsetHeight;
    // The selected value is the item under the CENTERED highlight band (the wheel
    // snaps items to center), not the item at the top of the viewport. Compute and
    // align on the centered item so the stored value matches what the user sees.
    const centerH = () => host.clientHeight / 2 - rowH() / 2;
    const scrollForValue = (v: number) => {
      // If initialized or at exact top (initial state), set to the middle of the loop
      if (host.scrollTop === 0) {
        const middleBlock = Math.floor(loopCount / 2);
        return (padN + middleBlock * count + v) * rowH() - centerH();
      }
      // Otherwise, snap to nearest instance
      const currentI = Math.round((host.scrollTop - centerH()) / rowH()) - padN;
      let currentV = ((currentI % count) + count) % count;
      let diff = v - currentV;
      if (diff > count / 2) diff -= count;
      if (diff < -count / 2) diff += count;
      return (padN + currentI + diff) * rowH() - centerH();
    };
    const centeredValue = (): number => {
      const i = Math.round((host.scrollTop + host.clientHeight / 2 - rowH() / 2) / rowH()) - padN;
      return ((i % count) + count) % count;
    };
    requestAnimationFrame(() => {
      host.scrollTop = scrollForValue(cur);
      // Ensure the readout triggers to paint initial preview
      readout();
    });
    host.addEventListener("scroll", () => {
      const v = centeredValue();
      onPick(v);
      host.querySelectorAll<HTMLElement>(".wheel-item").forEach((b) =>
        b.classList.toggle("sel", Number(b.dataset.v) === v));
      readout();
    }, { passive: true });
    // Step exactly one item per mouse-wheel notch (native wheel jumps several rows).
    host.addEventListener("wheel", (e) => {
      e.preventDefault();
      const dir = e.deltaY > 0 ? 1 : -1;
      const next = (centeredValue() + dir + count) % count;
      host.scrollTop = scrollForValue(next);
    }, { passive: false });
    host.querySelectorAll<HTMLButtonElement>(".wheel-item").forEach((b) =>
      (b.onclick = (e) => {
        e.stopPropagation();
        const v = Number(b.dataset.v);
        onPick(v);
        host.scrollTop = scrollForValue(v);
        host.querySelectorAll<HTMLElement>(".wheel-item").forEach((x) => x.classList.toggle("sel", Number(x.dataset.v) === v));
      }));
  };

  const render = () => {
    const hourCol = military ? 24 : 12;
    pop.innerHTML = `
      <div class="pop-head"><span class="pop-title">Time</span>${military ? "" : `<button type="button" class="pop-meridiem" id="tcMer">${pm ? "PM" : "AM"}</button>`}</div>
      <div class="time-wrap">
        <div class="wheel" id="tcHour"></div>
        <span class="wheel-sep">:</span>
        <div class="wheel" id="tcMin"></div>
      </div>
      <div class="time-foot">
        <span class="time-read"></span>
        <button type="button" class="btn primary" id="tcOk">Set</button>
      </div>`;
    readout();
    buildWheel(
      pop.querySelector<HTMLElement>("#tcHour")!,
      hourCol,
      military ? h : h12,
      40,
      military ? (v) => String(v).padStart(2, "0") : (v) => String(v + 1).padStart(2, "0"),
      (v) => { if (military) h = v; else h12 = v; readout(); }
    );
    buildWheel(
      pop.querySelector<HTMLElement>("#tcMin")!,
      60, m, 40,
      (v) => String(v).padStart(2, "0"),
      (v) => { m = v; readout(); }
    );
    const mer = pop.querySelector<HTMLButtonElement>("#tcMer");
    if (mer) mer.onclick = (e) => { e.stopPropagation(); pm = !pm; mer.textContent = pm ? "PM" : "AM"; readout(); };
    pop.querySelector<HTMLButtonElement>("#tcOk")!.onclick = (e) => {
      e.stopPropagation();
      onPicked(`${String(to24()).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
      closePop();
    };
  };
  render();
  mountPop(trigger, pop);
}
