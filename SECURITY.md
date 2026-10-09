# Security operations

Cirkitra uses Firebase Authentication, Supabase with server-only service-role access, and PayPal. These controls reduce practical risk; no site can be guaranteed impossible to compromise. Report suspected vulnerabilities privately to the project owner rather than posting credentials or exploit details publicly.

## Provider settings

- **Firebase:** require verified email for Cirkitra sessions; keep the authorized domain list limited to production and deliberate preview/local origins. Never put Firebase Admin credentials in `NEXT_PUBLIC_*` variables. Rotate the service-account key if it may have been exposed.
- **Supabase:** enable RLS on every public table. Keep service-role keys only in server-side secret stores. Do not grant `anon` or `authenticated` access to billing, AI usage, admin grant, or audit tables. Privileged functions must pin `search_path`, revoke execution from `public`, `anon`, and `authenticated`, and grant only the server role that calls them. Repository tests scan migrations for these invariants; apply reviewed migrations through the normal database migration process.
- **PayPal:** keep the webhook ID and API credentials server-side. Leave webhook signature verification and event idempotency enabled. Use Sandbox while testing; do not enable live billing until the live application, plan, webhook, and account have been reviewed.
- **Credential rotation:** a PayPal Sandbox buyer password was shared in a conversation. The account owner must change that password in PayPal Sandbox now and must not reuse it on a real account. This repository does not store or reproduce that password. Rotate any other credential only if the provider audit/history indicates it was exposed; update the server secret store and revoke the prior credential.

## Request and browser protections

API handlers perform their own authentication/authorization checks. JSON and webhook bodies are read through byte-capped streams. Circuit generation and AI chat have separate account-scoped limits; the monthly successful-generation allowance remains separate. Same-origin mutation checks compare the browser `Origin` with the request URL and do not trust forwarded host/protocol headers. The CSP uses a per-request nonce, keeps production scripts free of `unsafe-inline`/`unsafe-eval`, and explicitly allows the Firebase/Google, configured Supabase, and PayPal origins required by sign-in and billing. Review the CSP whenever a third-party integration is added.

## Host-native per-IP rate limits

Account limits do not stop an attacker from creating many accounts, so configure the hosting WAF as a second layer. These are operator steps; this repo change does not access or modify live provider settings. Begin in log/monitor mode, inspect real traffic, then enable rate-limit actions. Keep PayPal webhook limits generous so valid retries are not dropped.

Suggested starting thresholds, counted by source IP:

| Request | Starting threshold | Notes |
| --- | ---: | --- |
| `POST /api/ai/generate` | 30 per 60 seconds | The app separately limits authenticated Build and Chat accounts. A higher IP threshold allows a few users behind one NAT. |
| `POST /api/compile` | 60 per 60 seconds | Authenticated, local simulation only. |
| `POST /api/auth/session` | 10 per 60 seconds | Firebase verifies the token; use monitor mode first to avoid locking out shared networks. |
| `POST /api/billing/paypal/*` except `/webhook` | 20 per 60 seconds | Mutations also require a same-origin request and verified account. |
| `POST /api/billing/paypal/webhook` | 120 per 60 seconds | Preserve PayPal retries and signature verification; adjust using observed provider traffic. |

**Vercel:** in the project dashboard open **Firewall → Configure → New Rule**, match the HTTP method and exact request path, choose **Rate Limit**, use a 60-second fixed window and the source IP key, and initially choose **Log**. Review observed traffic before changing to a 429/rate-limit action. Apply separate rules for the paths above; exclude the webhook from the tighter billing rule. See [Vercel WAF rate limiting](https://vercel.com/docs/vercel-firewall/vercel-waf/rate-limiting).

**Cloudflare:** in the zone dashboard create a **WAF → Rate limiting rule** for the same method/path expressions and thresholds. Use the source IP as the counting characteristic (Cloudflare also includes its data-center characteristic), start with a non-blocking/logging action where available, then enable a short block/429 response after reviewing traffic. Exclude the webhook from the tighter billing rule. See [Cloudflare rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/).

Do not trust a user-supplied `X-Forwarded-For` or similar header in application code to make these decisions; the WAF should use the platform's observed client address.

## CI and incident checklist

- `.github/workflows/security.yml` scans full Git history for secrets and runs `npm audit`, lint, TypeScript, and the build/test suite sequentially.
- Dependabot checks npm packages and GitHub Actions weekly. Review and merge updates; a clean audit today is not a guarantee against future advisories.
- If a secret is found, revoke/rotate it at its provider first, update local/host secret stores, then remove it from the current tree and coordinate history cleanup. Rewriting history does not revoke a credential.
- For a suspected account compromise, revoke Firebase sessions/refresh tokens, rotate affected provider keys, inspect Supabase audit/provider logs and PayPal webhook events, and preserve relevant logs before cleanup.
- Do not run penetration tests against production or change provider security settings without explicit authorization.
