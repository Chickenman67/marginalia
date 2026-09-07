import {
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
  signInWithGitHub,
  sendPasswordReset
} from "../auth";

type Mode = "signin" | "signup" | "forgot";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function mountAuthScreen(root: HTMLElement): void {
  let mode: Mode = "signin";
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
          <button class="btn socbtn" id="authGoogle" type="button">
            <svg class="soc-ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"/><path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z"/><path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z"/><path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z"/></svg>
            <span>Continue with Google</span>
          </button>
          <button class="btn socbtn" id="authGitHub" type="button">
            <svg class="soc-ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="#24292F" d="M12 .5C5.73.5.5 5.73.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56v-2c-3.2.7-3.88-1.36-3.88-1.36-.53-1.34-1.28-1.69-1.28-1.69-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.19 1.77 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.76.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11.1 11.1 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.69 5.4-5.26 5.69.41.35.77 1.05.77 2.12v3.15c0 .31.21.68.8.56A11.51 11.51 0 0 0 23.5 12C23.5 5.73 18.27.5 12 .5z"/></svg>
            <span>Continue with GitHub</span>
          </button>
        </div>
        ${mode === "signin" ? `<button class="link" id="authForgot" type="button">Forgot password?</button>` : ""}
        <div class="auth-status ${statusKind}">${esc(status)}</div>
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
  }
  render();
}

export function unmountAuthScreen(root: HTMLElement): void {
  root.innerHTML = "";
}