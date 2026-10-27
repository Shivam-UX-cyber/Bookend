# Bookend Security Architecture & Verified Controls

This document details the verified security controls, configuration requirements, threat mitigations, and known security boundaries implemented in Bookend.

---

## 1. Verified Security Controls

### 1.1 Input Validation & Boundary Defense
- **Server Boundary Authority:** All external inputs (request body, path parameters, query parameters) are strictly validated and normalized at the server boundary using `express-validator` and Mongoose schema constraints. Client-side validation is treated strictly as an ergonomic UX layer.
- **Unicode Name Validation:** Names are validated using Unicode property escapes (`/\p{L}/u`), supporting international student names with accents, hyphens, and apostrophes while strictly rejecting script tags and HTML injection.
- **Bcrypt 72-Byte Boundary:** Candidate passwords are evaluated for UTF-8 byte length (using `Buffer.byteLength` on server and browser `TextEncoder` on client) to prevent bcrypt silent truncation attacks for passwords exceeding 72 bytes.
- **Integer Currency Model:** Book prices are stored strictly as integer paise (`priceInPaise`) with minimum (100 paise = ₹1) and maximum (10,000,000 paise = ₹1,00,000) boundaries, preventing floating-point rounding vulnerabilities and negative price exploits.

### 1.2 Injection & Prototype Pollution Defense
- **NoSQL Injection Defense:** Object queries received from clients are validated to ensure primitive string types, preventing MongoDB operator injection (e.g. `{ $ne: null }`).
- **Regular Expression Sanitization:** Marketplace search queries are sanitized with regular expression escaping before regex matching to prevent catastrophic backtracking (ReDoS).
- **Prototype Pollution Prevention:** Object spreading and assignments use explicit object initialization without merging unvalidated `__proto__` or `constructor` properties.

### 1.3 Cross-Site Request Forgery (CSRF) Defense
- **Custom Header Verification:** State-changing HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`) are protected by a custom header requirement (`X-Requested-With: XMLHttpRequest`). Standard cross-origin HTML `<form>` submissions cannot attach custom headers without CORS preflight authorization.
- **Strict Origin Whitelist:** The backend validates incoming `Origin` and `Referer` headers against the configured `CLIENT_URL`. Disallowed origins are rejected immediately with HTTP 403.

### 1.4 Session & Token Security
- **HttpOnly Cookies:** JWT tokens are transported in `HttpOnly` cookies, preventing token theft via Cross-Site Scripting (XSS).
- **Cross-Site Cookie Handling:** In production, cookies configure `SameSite=None` and `Secure=true` to enable cross-domain credentials between the frontend and backend Render web services.
- **Token Version Invalidation:** Users maintain an integer `tokenVersion`. Incrementing `tokenVersion` on password reset or logout instantly invalidates all existing JWTs across all devices.

### 1.5 Rate Limiting & Anti-Enumeration
- **Targeted Rate Limiters:**
  - Login attempts: 10 requests per 15 minutes per IP.
  - Registration / OTP generation: 5 requests per 15 minutes per IP.
  - OTP resend: Strict 60-second cooldown between attempts.
  - Remote diagnostics: 5 requests per minute per IP.
- **Account Enumeration Mitigation:** Login and password reset endpoints return generic, uniform responses for non-existent users, invalid passwords, or unverified accounts.

### 1.6 Secret Redaction & Diagnostic Security
- **Strict Log Masking:** Email addresses are masked (`c***t@gmail.com`) and secrets are redacted in console logs.
- **Protected Remote Diagnostics:** The `/api/auth/diagnostic-smtp` endpoint is protected by a dedicated `DIAGNOSTIC_KEY`. It returns HTTP 404 when disabled, requires header authentication (`x-diagnostic-key`), rejects non-whitelisted host queries, and redacts API keys and credentials in diagnostic output.

---

## 2. Container & Infrastructure Security

1. **Non-Root Execution:** The backend container enforces `USER node` (UID 1000). The process cannot modify container system binaries.
2. **Minimal Attack Surface:** Multi-stage Docker builds copy only compiled artifacts and production dependencies. Source files, tests, and documentation are excluded via `.dockerignore`.
3. **Information Disclosure Prevention:** Nginx configures `server_tokens off;` to suppress version headers.

---

## 3. Known Limitations & Residual Risks

1. **Render Free Tier Cold Starts:** Free instances spin down after inactivity, resulting in a 30–60 second latency on initial requests.
2. **Resend Free Tier Domain Restrictions:** When using `onboarding@resend.dev`, Resend restricts outbound email delivery to the single email address associated with the Resend account owner. Production campus deployment requires verifying a custom campus domain in Resend.
3. **No Multi-Factor Authentication (MFA):** Beyond registration email OTP and password recovery OTP, active sessions rely on single-factor password authentication.
