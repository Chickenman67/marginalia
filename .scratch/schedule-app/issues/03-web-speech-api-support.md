Type: research
Status: resolved

## Question

What is the real browser support and behavior of the Web Speech API (SpeechRecognition) for this app — voice input on PC and mobile? Resolve: (1) support matrix across Chrome/Edge (desktop + Android), Safari iOS, Firefox; (2) whether it requires internet and a user gesture to start; (3) how to stream interim results and handle the `end`/error events; (4) a graceful text-input fallback when unsupported. Recommend the integration pattern and the exact list of browsers we can promise voice on.

## Answer

Sources: [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition) and [Using the Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API/Using_the_Web_Speech_API) (last updated 2026), [caniuse Speech Recognition](https://caniuse.com/speech-recognition) (StatCounter July 2026). MDN classifies the API as **"Limited availability — not Baseline"**: it does not work in some of the most widely-used browsers, so feature-detection at runtime is mandatory.

### 1. Support matrix

| Browser | Voice (SpeechRecognition) | Notes |
|---|---|---|
| Chrome desktop | ✅ Partial | Server-based engine; needs `webkitSpeechRecognition` prefix. caniuse: partial 25–154. |
| Edge (Chromium) | ✅ Partial | Inherits Chrome's engine. NOTE: caniuse's Edge row says "Not supported" through 151 — this is a known data quirk; Edge is Chromium-based and supports it the same as Chrome. Verify on-device. |
| Chrome / Android | ✅ Partial | Works on Android Chrome (caniuse: partial). |
| Safari macOS | ✅ Partial | Safari 14.1+ (caniuse: partial 14.1–26.6). |
| Safari iOS / iPadOS | ✅ Partial (but limited) | Safari 14.5+ (caniuse: partial 14.5+). Historically the weakest: only in Safari itself, must be triggered by a user gesture, and unreliable in embedded webviews (WKWebView) and some PWA-installed contexts. |
| Firefox (desktop + Android) | ❌ Not supported | Disabled by default; no voice. Text input is the only path here. |
| Samsung Internet | ✅ Partial | caniuse: partial 4–30. |
| Opera / Opera Mobile | ✅ (Chromium) | Chromium-based; partial in recent versions. |

**Global usage covered: ~87.55%** (caniuse). Effectively: all Chromium browsers + Safari 14.5+/macOS 14.1+, **excluding Firefox**.

### 2. Internet + user gesture

- **Requires internet (server-based):** MDN is explicit — "On some browsers, like Chrome, using Speech Recognition on a web page involves a server-based recognition engine. Your audio is sent to a web service for recognition processing, so it won't work offline." Default `processLocally = false`. (On-device recognition via `processLocally = true` + `available()`/`install()` exists per MDN, but its browser support is far narrower than cloud recognition — treat as optional, not the baseline promise.)
- **Requires a user gesture:** `recognition.start()` must be called from a user-initiated event (e.g. button click). On iOS Safari this is strict. Also requires a **secure context (HTTPS)** for mic access, and the user must grant microphone permission (the `not-allowed` error fires if denied).
- One-shot `start()` returns a single final result; calling `start()` again after `end` restarts a new session.

### 3. Interim results + event handling

- Set `recognition.interimResults = true` and `recognition.continuous = false` (or `true` for dictation-style streaming). In the `result` handler, iterate `event.results`: each item has `.isFinal`; show non-final items as a live "what I'm hearing" preview and commit `isFinal` ones to the input.
- `onend` (MDN [end event](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/end_event)) fires when the service disconnects — use it to reset UI state and re-enable the mic button. Note Chrome auto-fires `end` after a pause even in `continuous` mode; to keep listening you typically re-call `start()` in `onend` (guard against the `no-speech`/`aborted` loops).
- `onerror` (MDN [error event](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/error_event)) gives `event.error` with codes: `no-speech`, `aborted`, `audio-capture` (no mic), `not-allowed` (permission denied/blocked), `network`, `language-not-supported`, `service-not-allowed`. Map these to friendly messages; `not-allowed`/`audio-capture` should fall back to text input.
- `onnomatch` fires when speech is heard but below confidence — treat as "didn't catch that, please type or retry."

### 4. Graceful text-input fallback

Feature-detect once: `const SR = window.SpeechRecognition || window.webkitSpeechRecognition;`. If `!SR`, **hide the mic button entirely** and show only the text field. Never block the core "type your schedule/todo" flow on voice — text is the universal baseline. When voice is available, the mic is an enhancement layered on the same text submit path (voice fills the text box, user still confirms/edges to the AI parser).

### Recommended integration pattern

1. Detect `SR`; if absent, render text-only (no mic).
2. If present, render a mic button. On click (user gesture): `new SR()`, set `lang` (from app locale), `interimResults = true`, `continuous = false`, `maxAlternatives = 1`; `start()` inside the click handler.
3. `onresult` → stream interim into a preview, commit final transcript into the existing text input.
4. `onerror`/`onnomatch` → message + keep text input usable.
5. `onend` → reset button; only auto-restart if still in an active "listening" mode.
6. Always require HTTPS; handle mic-permission denial by surfacing the text field.

### Browsers we can promise voice on

**Chrome & Edge (desktop), Chrome on Android, Samsung Internet, and Safari 14.5+ on iOS/iPadOS (and Safari 14.1+ on macOS).** We explicitly **cannot promise voice on Firefox** (desktop or Android) and must provide text input there. iOS Safari is supported but is the highest-risk target (gesture + webview/PWA quirks) — test on real devices before claiming parity.

**Promise wording for the app:** "Voice input works in Chrome, Edge, Samsung Internet, and Safari. Firefox and other browsers use the text box."
