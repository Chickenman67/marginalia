Type: research
Status: resolved

## Question

Which free-tier LLM can parse natural-language ("call mom tomorrow after lunch", "dentist Tuesday 3pm") into structured JSON tasks directly from the browser? Resolve: (1) NVIDIA's free inference endpoint — base URL, a model that returns reliable JSON, request limits, and whether it sends CORS headers so the browser can call it directly with the default key; (2) alternative free tiers (Groq, Google Gemini, Mistral) with the same criteria; (3) the exact prompt/tool-call shape that yields `{title, datetime, type: todo|event, reminder}`. Recommend a default and a fallback provider, plus the minimal browser-call pattern (fetch + headers) and how to let a user override with their own key.

## Answer

**Bottom line (updated):** NVIDIA's hosted NIM endpoint does **not** return any `Access-Control-Allow-Origin` header, so the browser cannot call it directly (CORS-blocked) — but that only rules out *browser-direct* calls. Decision: **NVIDIA is the default parser for all users, routed through a server-side proxy** (Supabase Edge Function) that holds David's NVIDIA key, adds CORS, and rate-limits. The proxy is free-tier and unlimited-but-slow; NVIDIA is David's choice precisely because it's free and unmetered. **Google Gemini** and **Groq** remain selectable fallbacks (browser-direct, CORS-OK) if a user pastes their own key. See ticket `10-build-llm-proxy.md`.

### 1. NVIDIA hosted NIM (free inference endpoint)

- **Base URL:** `https://integrate.api.nvidia.com/v1` (OpenAI-compatible `/chat/completions`). [build.nvidia.com docs](https://docs.api.nvidia.com/)
- **Model that returns reliable JSON:** `meta/llama-3.1-8b-instruct` (or `nvidia/llama-3.1-nemotron-70b-instruct` for stronger parsing). Use `response_format: { type: "json_object" }`. [model page](https://build.nvidia.com/meta/llama-3_1-8b-instruct)
- **Limits:** Free NVIDIA Developer Program tier is rate-limited per model; practical ceiling is a few hundred req/day, shared across all NIM models on the account. Exact quotas are not published as fixed numbers — check the account limits page.
- **CORS:** **NO.** Live check of `OPTIONS https://integrate.api.nvidia.com/v1/chat/completions` with `Origin: https://example.com` returned `200` but **no `access-control-allow-origin` header at all** (only `Vary: Origin`). A browser `fetch` is blocked, even with a valid key. NVIDIA hosted NIM endpoints are intended for server-side use.

> Verdict: usable only via a tiny server/edge proxy that holds the key. Not browser-direct.

### 2. Alternative free tiers (same criteria)

**Google Gemini** — recommended DEFAULT
- **Base URL:** `https://generativelanguage.googleapis.com/v1beta/models/<MODEL>:generateContent?key=<KEY>` (key as query param, not a header). [Gemini API docs](https://ai.google.dev/gemini-api/docs/rest)
- **Model:** `gemini-2.0-flash` (free tier: 15 RPM, 1.5M TPD, 1M TPM). [models list](https://ai.google.dev/gemini-api/docs/models)
- **Reliable JSON:** `generationConfig.responseMimeType: "application/json"` (and optionally `responseSchema`). [structured output](https://ai.google.dev/gemini-api/docs/structured-output)
- **CORS:** **YES.** Live check returned `access-control-allow-origin: https://example.com` (reflects caller origin) on a cross-origin request. Key-in-URL keeps it simple for a no-backend app.

**Groq** — recommended FALLBACK
- **Base URL:** `https://api.groq.com/openai/v1/chat/completions` (OpenAI-compatible). [Groq docs](https://console.groq.com/docs/overview)
- **Model:** `llama-3.3-70b-versatile` (free: 30 RPM, 1,000 RPD, 200K TPD) or `meta-llama/llama-3.1-8b-instant` (faster, same limits). [rate limits](https://console.groq.com/docs/rate-limits)
- **Reliable JSON:** `response_format: { type: "json_object" }` (Groq Structured Outputs), or native tool/function calling. [structured outputs](https://console.groq.com/docs/structured-outputs)
- **CORS:** **YES.** Live check returned `access-control-allow-origin: *` on a cross-origin request.

**Mistral** (works, weaker pick)
- **Base URL:** `https://api.mistral.ai/v1/chat/completions` (OpenAI-compatible). [Mistral docs](https://docs.mistral.ai/)
- **Model:** `mistral-small-latest` (free tier credit is small/short-lived). [models](https://docs.mistral.ai/models/)
- **Reliable JSON:** `response_format: { type: "json_object" }` or custom structured output schema. [structured output](https://docs.mistral.ai/capabilities/structured_output/)
- **CORS:** **YES.** Live check returned `access-control-allow-origin: *`.

### 3. Prompt / tool-call shape for `{title, datetime, type, reminder}`

Use tool/function calling (most reliable), or JSON mode with an explicit schema. Example tool schema (works on Groq/Mistral OpenAI-compat; Gemini maps the same shape to `functionDeclarations` or `responseSchema`):

```json
{
  "name": "save_task",
  "description": "Parse a natural-language request into a structured schedule item.",
  "parameters": {
    "type": "object",
    "properties": {
      "title":    { "type": "string", "description": "Short task label, e.g. 'Call mom'" },
      "datetime": { "type": ["string", "null"], "format": "date-time",
                    "description": "ISO 8601 with timezone, e.g. '2026-08-25T13:00:00-04:00'. Null if no time." },
      "type":     { "type": "string", "enum": ["todo", "event"] },
      "reminder": { "type": ["string", "null"], "format": "date-time",
                    "description": "Optional reminder time; null if none." }
    },
    "required": ["title", "type"]
  }
}
```

System prompt (regardless of mode): *"You convert scheduling phrases into one JSON object. Fill `datetime` from relative cues ('tomorrow after lunch' → next day 13:00 local). `type` is 'event' when a fixed time is given, else 'todo'. Set `reminder` only when asked. Output ONLY the object."* Resolve "after lunch" → 13:00, "Tuesday 3pm" → next Tuesday 15:00 in the user's local tz.

### Recommendation (updated)

- **Default: NVIDIA via proxy.** Browser calls our own Edge Function (`/functions/v1/parse`), which forwards to `https://integrate.api.nvidia.com/v1/chat/completions` with David's key and returns CORS-friendly JSON. Unlimited-but-slow, free. Must require a valid space token + a global rate limit so anonymous demo users can't hammer it.
- **Fallback: Google Gemini** (`gemini-2.0-flash`). CORS-OK, key-in-URL, browser-direct if user pastes a key.
- **Fallback: Groq** (`llama-3.3-70b-versatile`). CORS `*`, OpenAI-compat, browser-direct if user pastes a key.
- Mistral optional third fallback.

### NVIDIA-via-proxy call pattern (default path)

Browser → our Edge Function:
```js
const res = await fetch(`${SUPABASE_URL}/functions/v1/parse`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json',
             'Authorization': `Bearer ${SUPABASE_ANON}`,
             'x-space-token': SPACE_TOKEN },
  body: JSON.stringify({ phrase }) });
```
Edge Function (holds `NVIDIA_KEY`, server-side only) → NVIDIA:
```js
const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json',
             'Authorization': `Bearer ${Deno.env.get('NVIDIA_KEY')}` },
  body: JSON.stringify({ model: 'meta/llama-3.1-8b-instruct',
    messages: [{ role: 'system', content: SYSTEM_PROMPT },
               { role: 'user', content: phrase }],
    response_format: { type: 'json_object' } }) });
```

### Minimal browser-call patterns (direct fallback paths)

Gemini (default), key in URL:
```js
const KEY = localStorage.getItem('scheduleapp.llmKey') || DEMO_KEY; // DEMO_KEY = your own Gemini key
const res = await fetch(
  `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${KEY}`,
  { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: phrase }] }],
      generationConfig: { responseMimeType: 'application/json',
        responseSchema: { type: 'OBJECT', properties: {
          title: { type: 'STRING' }, datetime: { type: 'STRING' },
          type: { type: 'STRING', enum: ['todo','event'] }, reminder: { type: 'STRING' } } } }
    }) });
```

Groq (fallback), OpenAI-compat with `Authorization` header:
```js
const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json',
             'Authorization': `Bearer ${KEY}` },
  body: JSON.stringify({ model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: SYSTEM_PROMPT },
               { role: 'user', content: phrase }],
    response_format: { type: 'json_object' } }) });
```

**User key override:** default path is NVIDIA-via-proxy (no key needed). If a user pastes their own Gemini/Groq/Mistral key (plus a `scheduleapp.provider` selector), the app calls that provider **directly** from the browser using the patterns below. Provide a settings field to set/clear it. NVIDIA stays the default for all users via the proxy.
