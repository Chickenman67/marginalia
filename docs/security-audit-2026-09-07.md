# Security Audit Report: ToDoApp (Marginalia)

**Audit Date:** September 7, 2026  
**Target Application:** https://marginalia-6ek.pages.dev  
**Auditor:** Kiro AI Security Assessment  
**Audit Framework:** OWASP Top 10 (2021), API Security Best Practices

---

## Executive Summary

A comprehensive security audit was conducted on the ToDoApp (Marginalia) web application. The application demonstrates **strong security fundamentals** with proper authentication, authorization, and secure coding practices. The audit identified several areas where security can be further enhanced.

**Overall Security Posture:** ✅ **GOOD** (with recommendations for improvement)

**Risk Summary:**
- 🟢 **0 Critical vulnerabilities**
- 🟡 **3 Medium-risk findings**
- 🟡 **4 Low-risk recommendations**

---

## Application Overview

### Technology Stack
- **Frontend:** Vanilla TypeScript, Vite build system
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions, Realtime)
- **Authentication:** Supabase Auth (email/password, Google OAuth, GitHub OAuth)
- **Hosting:** Cloudflare Pages
- **CDN:** Cloudflare
- **External APIs:** NVIDIA NIM (via proxy), Google Gemini, Groq

### Attack Surface
- Public web application at https://marginalia-6ek.pages.dev
- Authentication endpoints (sign-up, sign-in, OAuth callbacks)
- 3 Supabase Edge Functions: `/parse`, `/polish`, `/claim-space`
- Supabase PostgreSQL database with RLS policies
- Real-time WebSocket connections (Supabase Realtime)

---

## Security Findings

### ✅ STRENGTHS

#### 1. Strong Content Security Policy (CSP)
**Status:** ✅ Excellent

The application implements a strict CSP that significantly reduces XSS attack surface:

```
Content-Security-Policy: 
  default-src 'self'; 
  script-src 'self'; 
  style-src 'self' fonts.googleapis.com; 
  font-src 'self' fonts.gstatic.com; 
  img-src 'self' data:; 
  connect-src 'self' https://*.supabase.co wss://*.supabase.co 
              https://generativelanguage.googleapis.com https://api.groq.com; 
  frame-ancestors 'none'; 
  base-uri 'self'; 
  form-action 'self'; 
  object-src 'none'
```

**Why this matters:** This policy prevents inline scripts, restricts external resources, and blocks clickjacking attacks.

#### 2. Row Level Security (RLS) Properly Implemented
**Status:** ✅ Excellent

Database access is secured with proper RLS policies:

```sql
-- Items table
create policy "items read own" on items for select 
  using ( user_id = auth.uid() );
create policy "items write own" on items for insert 
  with check ( user_id = auth.uid() );

-- Profiles table
create policy "profiles read own" on profiles for select 
  using ( user_id = auth.uid() );
```

**Why this matters:** Even if there's a bug in the application logic, users cannot access other users' data at the database level.

#### 3. Authentication & Session Management
**Status:** ✅ Good

- Supabase Auth handles authentication securely
- JWT tokens with automatic refresh (1-hour expiry)
- OAuth providers (Google, GitHub) properly configured
- Session persistence uses secure httpOnly cookies (managed by Supabase)
- Password reset flow uses secure token-based mechanism

#### 4. Additional Security Headers
**Status:** ✅ Excellent

```
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Permissions-Policy: geolocation=(), camera=(), microphone=(self)
```

#### 5. Edge Function Authentication
**Status:** ✅ Good

All Edge Functions verify JWT tokens:

```typescript
const { data: { user }, error } = await supabase.auth.getUser(jwt);
if (error || !user) return new Response("Unauthorized", { status: 401 });
```

#### 6. Rate Limiting
**Status:** ✅ Good

Per-user rate limiting is implemented in the `parse` Edge Function:

```typescript
const { data: canProceed, error: rateErr } = 
  await supabase.rpc("check_rate_limit", { user_id: user.id });
```

---

### 🟡 MEDIUM-RISK FINDINGS

#### M1: Missing Strict-Transport-Security Header (HSTS)
**Risk Level:** 🟡 Medium  
**OWASP Category:** A05:2021 – Security Misconfiguration

**Finding:**  
The application does not set the `Strict-Transport-Security` header, which could allow protocol downgrade attacks.

**Current State:**
```
# Missing
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

**Impact:**  
An attacker on the same network could intercept the first HTTP request before HTTPS redirect and perform a man-in-the-middle attack.

**Recommendation:**  
Add HSTS header to `public/_headers`:

```
/*
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' fonts.googleapis.com; font-src 'self' fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://generativelanguage.googleapis.com https://api.groq.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: geolocation=(), camera=(), microphone=(self)
```

---

#### M2: API Keys Stored in localStorage
**Risk Level:** 🟡 Medium  
**OWASP Category:** A01:2021 – Broken Access Control

**Finding:**  
User-provided API keys (Gemini, Groq) are stored in browser localStorage:

```typescript
// src/config.ts
export const STORAGE_KEYS = {
  llmKey: "scheduleapp.llmKey",
  provider: "scheduleapp.provider"
};
```

**Impact:**  
- localStorage is accessible to any script running on the page
- Keys are not encrypted
- Keys persist across sessions
- XSS vulnerability could lead to key theft (though CSP mitigates this)

**Current Mitigations:**
- Strong CSP limits XSS attack surface
- Keys are only used for optional third-party LLM providers (user's own keys)

**Recommendation:**  
Consider these alternatives:
1. **Backend proxy approach** (like NVIDIA): Store user API keys server-side in the `profiles` table (encrypted at rest by Supabase), and proxy all API calls through Edge Functions
2. **Session-only storage**: Use `sessionStorage` instead of `localStorage` so keys don't persist
3. **Key encryption**: Encrypt keys in localStorage using Web Crypto API with a session-derived key

**Priority:** Medium (mitigated by strong CSP, but still a risk)

---

#### M3: No Password Strength Requirements
**Risk Level:** 🟡 Medium  
**OWASP Category:** A07:2021 – Identification and Authentication Failures

**Finding:**  
The application accepts weak passwords. Supabase Auth's default minimum is 6 characters.

**Current Database Config:**
```sql
password_min_length: 6
password_required_characters: null
password_hibp_enabled: false
```

**Impact:**  
Users can create accounts with easily guessable passwords like "123456".

**Recommendation:**  
Enable password strength requirements in Supabase dashboard:

1. **Minimum length**: 12 characters (current: 6)
2. **Required characters**: Enable mix of uppercase, lowercase, numbers
3. **HIBP (Have I Been Pwned) check**: Enable to reject compromised passwords

**Implementation:**
```bash
# Via Supabase Management API or dashboard
PATCH /v1/projects/{ref}/config/auth
{
  "password_min_length": 12,
  "password_required_characters": "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
  "password_hibp_enabled": true
}
```

---

### 🔵 LOW-RISK FINDINGS & RECOMMENDATIONS

#### L1: Missing Subresource Integrity (SRI)
**Risk Level:** 🔵 Low  
**OWASP Category:** A08:2021 – Software and Data Integrity Failures

**Finding:**  
External resources (Google Fonts) loaded without SRI hashes:

```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces..." rel="stylesheet" />
```

**Impact:**  
If Google Fonts CDN is compromised, malicious code could be injected.

**Recommendation:**  
Add SRI hashes or self-host fonts:

```html
<link href="https://fonts.googleapis.com/css2?family=Fraunces..." 
      rel="stylesheet" 
      integrity="sha384-..." 
      crossorigin="anonymous" />
```

Or better: self-host fonts in `/public/fonts/` to eliminate external dependency entirely.

**Priority:** Low (Google Fonts is a trusted source, CSP already restricts it)

---

#### L2: No Rate Limiting on Authentication Endpoints
**Risk Level:** 🔵 Low  
**OWASP Category:** A07:2021 – Identification and Authentication Failures

**Finding:**  
While the `/parse` Edge Function has rate limiting, the authentication endpoints (sign-in, sign-up) rely on Supabase's default rate limits.

**Current Supabase Limits:**
- `rate_limit_anonymous_users`: 30 requests per hour
- `rate_limit_verify`: 30 requests per hour

**Impact:**  
An attacker could attempt brute-force attacks or credential stuffing, though the default limits provide some protection.

**Recommendation:**  
Explicitly configure stricter auth rate limits in Supabase:

```bash
PATCH /v1/projects/{ref}/config/auth
{
  "rate_limit_anonymous_users": 10,
  "rate_limit_verify": 15
}
```

Consider adding CAPTCHA for sign-in after 3 failed attempts.

**Priority:** Low (Supabase defaults are reasonable)

---

#### L3: No Content Security Policy Reporting
**Risk Level:** 🔵 Low  
**OWASP Category:** A09:2021 – Security Logging and Monitoring Failures

**Finding:**  
The CSP doesn't include a `report-uri` or `report-to` directive to monitor violations.

**Recommendation:**  
Add CSP reporting to detect potential attacks or CSP misconfigurations:

```
Content-Security-Policy: 
  default-src 'self'; 
  ...
  report-uri https://your-csp-report-endpoint.example/csp-report;
```

Or use a free service like Report URI (https://report-uri.com/).

**Priority:** Low (monitoring enhancement, not a vulnerability)

---

#### L4: Session Timeout Not Configured
**Risk Level:** 🔵 Low  
**OWASP Category:** A07:2021 – Identification and Authentication Failures

**Finding:**  
No inactivity timeout configured for user sessions.

**Current Config:**
```sql
sessions_inactivity_timeout: null
jwt_exp: 3600  # 1 hour
```

**Impact:**  
A user's session persists indefinitely if they don't sign out, even after long periods of inactivity.

**Recommendation:**  
Configure session inactivity timeout:

```bash
PATCH /v1/projects/{ref}/config/auth
{
  "sessions_inactivity_timeout": 86400  # 24 hours in seconds
}
```

This will automatically sign out users after 24 hours of inactivity.

**Priority:** Low (JWT expiry provides some protection)

---

## OWASP Top 10 Coverage

### ✅ A01:2021 – Broken Access Control
**Status:** SECURE  
- RLS policies properly enforce user-level access control
- All database operations filtered by `auth.uid()`
- Edge Functions verify JWT tokens

### ✅ A02:2021 – Cryptographic Failures
**Status:** SECURE  
- All traffic uses HTTPS (enforced by Cloudflare)
- Passwords hashed by Supabase Auth (bcrypt)
- JWTs signed with HS256
- **Recommendation:** Add HSTS header (see M1)

### ✅ A03:2021 – Injection
**Status:** SECURE  
- No direct SQL queries in application code
- All database access through Supabase client (parameterized queries)
- Edge Functions use parameterized queries
- LLM prompts properly escaped

### ✅ A04:2021 – Insecure Design
**Status:** SECURE  
- Authentication required for all user data
- Proper separation of concerns (client/server)
- Rate limiting on critical endpoints

### 🟡 A05:2021 – Security Misconfiguration
**Status:** MOSTLY SECURE  
- Strong CSP and security headers
- **Issue:** Missing HSTS header (M1)
- **Issue:** Weak password requirements (M3)

### ✅ A06:2021 – Vulnerable and Outdated Components
**Status:** SECURE (requires monitoring)  
- Modern dependencies (@supabase/supabase-js@2.112.4)
- Vite build system (v5.4.21)
- **Recommendation:** Enable Dependabot or Snyk for automated dependency scanning

### 🟡 A07:2021 – Identification and Authentication Failures
**Status:** MOSTLY SECURE  
- Supabase Auth provides secure authentication
- **Issue:** Weak password requirements (M3)
- **Issue:** No session inactivity timeout (L4)

### ✅ A08:2021 – Software and Data Integrity Failures
**Status:** SECURE  
- No deserialization of untrusted data
- External resources restricted by CSP
- **Minor:** Missing SRI on Google Fonts (L1)

### ✅ A09:2021 – Security Logging and Monitoring Failures
**Status:** ADEQUATE  
- Supabase provides audit logs
- **Recommendation:** Enable CSP reporting (L3)

### ✅ A10:2021 – Server-Side Request Forgery (SSRF)
**Status:** NOT APPLICABLE  
- No user-controlled URLs in server-side requests
- External API calls are to fixed endpoints (NVIDIA, Gemini, Groq)

---

## API Security Assessment

### Edge Functions Security

#### `/functions/v1/parse`
✅ **Authentication:** JWT required  
✅ **Rate Limiting:** Per-user rate limit enforced  
✅ **Input Validation:** Phrase input validated  
✅ **CORS:** Restricted to `APP_ORIGIN`  
⚠️ **Secret Management:** NVIDIA key stored in environment variable (secure)

#### `/functions/v1/polish`
✅ **Authentication:** JWT required  
✅ **Rate Limiting:** Per-user rate limit enforced  
✅ **CORS:** Restricted to `APP_ORIGIN`

#### `/functions/v1/claim-space`
✅ **Authentication:** JWT required  
✅ **Authorization:** Service role client used for privileged operations  
✅ **Input Validation:** Space token validated against database

### Database API Security
✅ **RLS Enabled:** All tables have RLS policies  
✅ **Anonymous Access:** Blocked (requires authentication)  
✅ **Service Role:** Only used in Edge Functions (server-side)

---

## Privacy & Data Protection

### Data Storage
- ✅ User data isolated by `user_id` (RLS)
- ✅ No PII in client-side logs
- ✅ Passwords never stored in plaintext

### Data Transmission
- ✅ All traffic over HTTPS
- ✅ WebSocket connections use WSS (encrypted)

### Third-Party Data Sharing
- ⚠️ User content sent to LLM providers (NVIDIA, Gemini, Groq) for parsing
- ⚠️ No explicit privacy policy or data processing agreement visible

**Recommendation:** Add privacy policy clarifying:
- What data is sent to LLM providers
- How long data is retained
- User's data deletion rights (GDPR compliance)

---

## Penetration Testing Results

### Authentication Testing
✅ **Password Reset:** Properly secured with token-based flow  
✅ **OAuth Flow:** Properly configured with PKCE  
✅ **Session Fixation:** Not vulnerable (Supabase handles session generation)  
✅ **Brute Force:** Protected by Supabase rate limits

### Authorization Testing
✅ **Horizontal Privilege Escalation:** Not possible (RLS enforced)  
✅ **Vertical Privilege Escalation:** Not applicable (no admin roles)

### Input Validation Testing
✅ **XSS:** Protected by CSP  
✅ **SQL Injection:** Not vulnerable (parameterized queries)  
✅ **Path Traversal:** Not applicable (no file system access)

---

## Recommendations Summary

### Critical Priority
None identified.

### High Priority
1. **Add HSTS header** (M1) - Prevents protocol downgrade attacks
2. **Strengthen password requirements** (M3) - Require 12+ character passwords with complexity

### Medium Priority
3. **Migrate API keys to server-side storage** (M2) - Remove keys from localStorage
4. **Add CSP reporting** (L3) - Monitor for CSP violations
5. **Configure session inactivity timeout** (L4) - Auto-logout after 24 hours idle

### Low Priority
6. **Add SRI to external resources** (L1) - Or self-host Google Fonts
7. **Stricter auth rate limits** (L2) - Add CAPTCHA after failed attempts
8. **Add privacy policy** - Clarify LLM data processing

---

## Compliance Notes

### OWASP ASVS Level 2
The application meets most OWASP ASVS Level 2 requirements for a standard web application.

### GDPR Considerations
- ✅ User data deletion: Available via account deletion (Supabase cascade delete)
- ⚠️ Data processing agreement: Not clearly documented for LLM providers
- ⚠️ Privacy policy: Missing

---

## Conclusion

The ToDoApp (Marginalia) demonstrates **strong security fundamentals** with proper authentication, authorization, and defense-in-depth strategies. The identified issues are primarily configuration improvements rather than critical vulnerabilities.

**Key Strengths:**
- Excellent Content Security Policy
- Proper Row Level Security implementation
- Secure authentication and session management
- Good API security practices

**Priority Actions:**
1. Add HSTS header to prevent protocol downgrade attacks
2. Strengthen password requirements (12+ characters, complexity, HIBP check)
3. Consider migrating user API keys to server-side encrypted storage

**Overall Risk Level:** 🟢 LOW

The application is **production-ready from a security perspective** with the recommended improvements prioritized for the next release.

---

**Report Generated:** 2026-09-07T17:54:16Z  
**Next Audit Recommended:** 2027-03-07 (6 months)
