import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSignInWithPassword = vi.fn();
const mockSignUp = vi.fn();
const mockSignInWithOAuth = vi.fn();
const mockResetPasswordForEmail = vi.fn();
const mockSignOut = vi.fn();
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signInWithPassword: mockSignInWithPassword,
      signUp: mockSignUp,
      signInWithOAuth: mockSignInWithOAuth,
      resetPasswordForEmail: mockResetPasswordForEmail,
      signOut: mockSignOut
    }
  })
}));

import {
  signInWithPassword,
  signUpWithPassword,
  signInWithGoogle,
  signInWithGitHub,
  sendPasswordReset
} from "../../src/auth";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("auth wrapper", () => {
  it("signInWithPassword returns ok:true on success", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { session: {} }, error: null });
    const r = await signInWithPassword("a@b.c", "pw");
    expect(r).toEqual({ ok: true });
    expect(mockSignInWithPassword).toHaveBeenCalledWith({ email: "a@b.c", password: "pw" });
  });

  it("signInWithPassword returns ok:false with message on error", async () => {
    mockSignInWithPassword.mockResolvedValue({ data: { session: null }, error: { message: "Invalid login" } });
    const r = await signInWithPassword("a@b.c", "wrong");
    expect(r.ok).toBe(false);
    expect(r.message).toBe("Invalid login");
  });

  it("signUpWithPassword returns ok:false when email already in use", async () => {
    mockSignUp.mockResolvedValue({ data: { user: null }, error: { message: "User already registered" } });
    const r = await signUpWithPassword("a@b.c", "pw");
    expect(r.ok).toBe(false);
    expect(r.message).toBe("User already registered");
  });

  it("signInWithGoogle calls signInWithOAuth with provider 'google' and opens a popup", async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: {}, error: null });
    const r = await signInWithGoogle();
    expect(r.ok).toBe(true);
    expect(mockSignInWithOAuth).toHaveBeenCalledWith({ provider: "google", options: { redirectTo: expect.any(String) } });
  });

  it("signInWithGitHub returns ok:false on popup_closed_by_user", async () => {
    mockSignInWithOAuth.mockResolvedValue({ data: null, error: { message: "popup_closed_by_user" } });
    const r = await signInWithGitHub();
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/closed/i);
  });

  it("sendPasswordReset returns ok:true on success", async () => {
    mockResetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    const r = await sendPasswordReset("a@b.c");
    expect(r.ok).toBe(true);
    expect(mockResetPasswordForEmail).toHaveBeenCalledWith("a@b.c", expect.any(Object));
  });
});