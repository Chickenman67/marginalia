Type: grilling
Status: resolved
Blocked by: 04

## Question

Design the space-token creation and demo/onboarding UX. Resolve: how a first-time user gets a space (auto-generate token + show it once, or "New space" button), whether the token is shown/copyable for re-use on a second device, how the demo link behaves for a stranger (auto fresh space vs prompt), and how the per-space item cap / idle-expiry guard rails from the map surface to the user. Agree the flow so the build ticket can implement it.

## Answer

Space-token UX implemented in `src/ui/header.ts` + `index.html` token modal:

- **First run:** a random `space-<uuid>` token is auto-generated and persisted (demo mode = localStorage; synced mode = Supabase). No account, no prompt required — the app is usable instantly.
- **Reuse on a second device:** the header space chip shows the token; clicking **copy** copies it; single-clicking the chip opens the token modal pre-filled with the current token (copy/join). Paste the same token on another device to share a space.
- **Demo stranger:** anyone opening the demo link gets their own auto token → their data is isolated in a separate partition. They can also click "New space" to generate a fresh one, or "Use this space" after pasting a friend's token.
- **Guard rails surfacing:** the 500-item cap is enforced server-side (DB trigger, ticket 07); if hit, the insert throws and the UI can show "space full." Idle-expiry of guest spaces is a backend/maintenance concern (cron/function) and stays in fog — it does not surface in the client UX v1.

Decisions: token is the only identity (no email/password); "New space" regenerates and reloads. Closing — the onboarding flow is settled and shipped.
