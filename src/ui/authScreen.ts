import {
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
  signInWithGitHub,
  sendPasswordReset
} from "../auth";

type Mode = "signin" | "signup" | "forgot";

function claimSpaceUrl(): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/claim-space`;
}

async function claimToken(token: string, jwt: string): Promise<{ ok: boolean; count?: number; message?: string }> {
  const r = await fetch(claimSpaceUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${jwt}` },
    body: JSON.stringify({ token })
  });
  if (!r.ok) return { ok: false, message: `${r.status} ${r.statusText}` };
  return (await r.json()) as { ok: boolean; count?: number };
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function mountAuthScreen(root: HTMLElement): void {
  let mode: Mode = "signin";
  let claimOpen = false;
  let status = "";
  let statusKind: "" | "good" | "bad" = "";

  function render() {
    root.innerHTML = `
      <div class="auth-card">
        <h1>Marginalia</h1>
        <p class="auth-tagline">Sign in to keep your tasks private and synced.</p>
        <div class="auth-tabs">
          <button class="auth-tab" data-mode="signin" aria-selected="${mode === "signin"}">Sign in</button>
          <button class="auth-tab" data-mode="signup" aria-selected="${mode === "signup"}">Create account</button>
        </div>
        <form id="authForm" class="auth-form" novalidate>
          <input type="email" id="authEmail" placeholder="you@example.com" required autocomplete="email" />
          ${mode === "signup" ? `<input type="password" id="authPw" placeholder="password (min 8 chars)" required minlength="8" autocomplete="new-password" />` : ""}
          ${mode === "signin"  ? `<input type="password" id="authPw" placeholder="password" required autocomplete="current-password" />` : ""}
          <button class="btn primary" type="submit">${mode === "signup" ? "Create account" : "Sign in"}</button>
        </form>
        <div class="auth-divider"><span>or</span></div>
        <div class="auth-social">
          <button class="btn" id="authGoogle" type="button">Continue with Google</button>
          <button class="btn" id="authGitHub" type="button">Continue with GitHub</button>
        </div>
        ${mode === "signin" ? `<button class="link" id="authForgot" type="button">Forgot password?</button>` : ""}
        <div class="auth-status ${statusKind}">${esc(status)}</div>
        <details class="auth-claim" ${claimOpen ? "open" : ""}>
          <summary>Have an old space token?</summary>
          <p>Paste a token from the previous version to attach its data to this account.</p>
          <input type="text" id="claimToken" placeholder="id.secret" />
          <button class="btn" id="claimGo" type="button">Claim</button>
          <div class="auth-claim-status"></div>
        </details>
      </div>
    `;
    root.querySelectorAll<HTMLButtonElement>(".auth-tab").forEach((b) => {
      b.onclick = () => { mode = b.dataset.mode as Mode; status = ""; statusKind = ""; render(); };
    });
    const form = root.querySelector<HTMLFormElement>("#authForm")!;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const email = (root.querySelector<HTMLInputElement>("#authEmail")!).value.trim();
      const pw = (root.querySelector<HTMLInputElement>("#authPw")!)?.value ?? "";
      status = "Working…"; statusKind = "";
      render();
      const r = mode === "signup"
        ? await signUpWithPassword(email, pw)
        : await signInWithPassword(email, pw);
      if (!r.ok) { status = r.message ?? "Sign-in failed."; statusKind = "bad"; render(); }
      // success: onAuthStateChange will unmount this screen
    };
    root.querySelector<HTMLButtonElement>("#authGoogle")!.onclick = async () => {
      const r = await signInWithGoogle();
      if (!r.ok) { status = r.message ?? "Sign-in failed."; statusKind = "bad"; render(); }
    };
    root.querySelector<HTMLButtonElement>("#authGitHub")!.onclick = async () => {
      const r = await signInWithGitHub();
      if (!r.ok) { status = r.message ?? "Sign-in failed."; statusKind = "bad"; render(); }
    };
    const forgot = root.querySelector<HTMLButtonElement>("#authForgot");
    if (forgot) forgot.onclick = async () => {
      const email = (root.querySelector<HTMLInputElement>("#authEmail")!).value.trim();
      if (!email) { mode = "forgot"; status = "Enter your email above first, then click again."; statusKind = "bad"; render(); return; }
      const r = await sendPasswordReset(email);
      status = r.ok ? "Check your email for a reset link." : (r.message ?? "Could not send reset.");
      statusKind = r.ok ? "good" : "bad";
      render();
    };
    const claimBtn = root.querySelector<HTMLButtonElement>("#claimGo");
    if (claimBtn) claimBtn.onclick = async () => {
      const tok = (root.querySelector<HTMLInputElement>("#claimToken")!).value.trim();
      const statusEl = root.querySelector<HTMLDivElement>(".auth-claim-status")!;
      if (!tok) { statusEl.textContent = "Paste a token first."; return; }
      statusEl.textContent = "Claiming…";
      // For claim we need a JWT. If the user is not signed in, ask them to sign in first.
      const { getSession } = await import("../auth");
      const session = await getSession();
      if (!session) {
        statusEl.textContent = "Sign in (or create an account) first, then claim.";
        return;
      }
      const r = await claimToken(tok, session.access_token);
      statusEl.textContent = r.ok
        ? `Claimed ${r.count ?? 0} item(s). Reloading…`
        : (r.message ?? "Claim failed.");
      if (r.ok) setTimeout(() => location.reload(), 800);
    };
  }
  render();
}

export function unmountAuthScreen(root: HTMLElement): void {
  root.innerHTML = "";
}