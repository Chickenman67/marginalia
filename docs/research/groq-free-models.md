# Groq Free-Tier Models (Research)

**Date of research:** 2026-08-27
**Scope:** Which Groq API models work with a free (no-cost) Groq API key, using only official Groq primary sources.
**Endpoint used:** OpenAI-compatible `https://api.groq.com/openai/v1/chat/completions`

## TL;DR

- **`llama-3.1-8b-instant` is DEPRECATED and was shut down on 2026-08-16.** That is why the user got `The model 'llama-3.1-8b-instant' does not exist or you do not have access to it.` It is not a typo — the model is gone from free/developer tiers.
- **Best current replacement for `llama-3.1-8b-instant`: `openai/gpt-oss-20b`** (officially recommended by Groq). See ["Deprecated Models"](#deprecated-status-of-llama-3.1-8b-instant).
- Also deprecated as of the same date: `llama-3.3-70b-versatile` → use `openai/gpt-oss-120b` or `qwen/qwen3.6-27b`.

## Confirmed current free-tier (no-cost) model IDs

Sources: Groq model list page and rate-limits page (both official). The table below lists the text-generation **production** models that are live as of 2026-08-27.

| Exact model ID | Context window (tokens) | Max completion | Free/Developer rate limits (RPM / RPD / TPM / TPD) | Status | Notes / price |
|---|---|---|---|---|---|
| `openai/gpt-oss-120b` | 131,072 | 65,536 | 30 / 1K / 8K / 200K | **Live** | $0.15 in / $0.60 out per 1M tokens |
| `openai/gpt-oss-20b` | 131,072 | 65,536 | 30 / 1K / 8K / 200K | **Live** | $0.075 in / $0.30 out per 1M tokens — **recommended Llama-3.1-8B replacement** |
| `qwen/qwen3.6-27b` | 131,072 | 16,384 | 30 / 1K / 8K / 200K | **Live** | $0.60 in / $3.00 out per 1M tokens |
| `qwen/qwen3.8-27b` | 131,042 | 16,384 | 30 / 1K / 8K / 2M | **Live** | $0.80 in / $4.00 out per 1M tokens (preview model) |
| `whisper-large-v3` | n/a (audio) | n/a | 20 / 2K (RPM/RPD), ASH 7.2K, ASD 28.8K | **Live** | Speech-to-text, $0.111/hr |
| `whisper-large-v3-turbo` | n/a (audio) | n/a | 20 / 2K (RPM/RPD), ASH 7.2K, ASD 28.8K | **Live** | Speech-to-text, $0.04/hr |
| `groq/compound` | 131,072 | 8,192 | 30 / 250 (RPM/RPD), TPM 70K | **Live (system)** | Compound agentic system, not a plain chat model |
| `groq/compound-mini` | 131,072 | 8,192 | 30 / 250 (RPM/RPD), TPM 70K | **Live (system)** | Compound agentic system |
| `openai/gpt-oss-safeguard-20b` | 131,072 | 65,536 | 30 / 1K / 8K / 200K | **Live** | Content-moderation / safeguard model |
| `canopylabs/orpheus-v1-english` | 4,000 | 50,000 | 10 / 100 / 1.2K / 3.6K | **Live (preview)** | Text-to-speech |
| `canopylabs/orpheus-arabic-saudi` | 4,000 | 50,000 | 10 / 100 / 1.2K / 3.6K | **Live (preview)** | Text-to-speech |

Notes:
- The rate-limit figures above are the **Free Plan** numbers from the rate-limits page. The models page shows **Developer plan** limits of 250K TPM / 1K RPM for `openai/gpt-oss-120b` and `openai/gpt-oss-20b`. The Free plan is more restrictive (8K TPM).
- Models shown as "Enterprise" on the models page (e.g. `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `minimaxai/minimax-m2.7`) are either deprecated or gated behind committed-spend contracts and are **not** available on a no-cost key.
- For plain chat-completion use with a free key, the realistic choices are: `openai/gpt-oss-20b` (small/fast, direct Llama-3.1-8B replacement), `openai/gpt-oss-120b` (larger, better quality), or `qwen/qwen3.6-27b`.

## Deprecated status of `llama-3.1-8b-instant`

**CONFIRMED DEPRECATED.** From Groq's official deprecation page:

- Announced 2026-06-17 (email to users); **shutdown date 2026-08-16**.
- "This deprecation applies to free and developer-tier usage; enterprise customers with a committed-spend contract are not affected."
- **Recommended replacement: `openai/gpt-oss-20b`.**

The models list page still renders a doc page for `llama-3.1-8b-instant` (showing ~560 tps, 131,072 context, 131,072 max output), but it is marked Enterprise and is no longer served on free/developer keys — hence the "does not exist or you do not have access" error. Because today's date (2026-08-27) is after the 2026-08-16 shutdown, the model is fully retired for free-tier users.

### Other notable deprecated models (free/developer)

| Deprecated model | Shutdown date | Official replacement |
|---|---|---|
| `llama-3.1-8b-instant` | 2026-08-16 | `openai/gpt-oss-20b` |
| `llama-3.3-70b-versatile` | 2026-08-16 | `openai/gpt-oss-120b` or `qwen/qwen3.6-27b` |
| `qwen/qwen3-32b` | 2026-07-17 | `openai/gpt-oss-120b` |
| `meta-llama/llama-4-scout-17b-16e-instruct` | 2026-07-17 | `openai/gpt-oss-120b` or `qwen/qwen3.6-27b` |
| `gemma2-9b-it` | 2025-10-08 | (was `llama-3.1-8b-instant`, now also gone) |
| `mixtral-8x7b-32768` | 2025-03-20 | `llama-3.3-70b-versatile` (now also gone) |

So the common "classic" free-tier IDs many tutorials cite — `llama-3.1-8b-instant`, `llama-3.3-70b-versatile`, `gemma2-9b-it`, `mixtral-8x7b-32768` — are **all retired** as of 2026-08-27.

## Recommendation for this app

Replace `llama-3.1-8b-instant` with **`openai/gpt-oss-20b`** as the default Groq fallback key model. Keep `openai/gpt-oss-120b` available as a higher-quality option and `qwen/qwen3.6-27b` as an alternative. All three are confirmed live on the free tier and use the same OpenAI-compatible endpoint with no code-structure changes (only the `model` string differs).

## Sources

- Groq supported models list: https://console.groq.com/docs/models
- Groq quickstart (endpoint + example model): https://console.groq.com/docs/quickstart
- Groq model deprecations (incl. `llama-3.1-8b-instant` shutdown 2026-08-16): https://console.groq.com/docs/deprecations
- `llama-3.1-8b-instant` model page (still published but Enterprise/deprecated): https://console.groq.com/docs/model/llama-3.1-8b-instant
- Groq rate limits (free plan RPM/RPD/TPM/TPD table): https://console.groq.com/docs/rate-limits
- Models API endpoint (live list, requires a key): `GET https://api.groq.com/openai/v1/models` with `Authorization: Bearer $GROQ_API_KEY` (documented at https://console.groq.com/docs/models). Not callable here (no key), so the live set above is taken from the official docs pages.
