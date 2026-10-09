# Supabase database setup for Cirkitra

Cirkitra uses Firebase Authentication and Supabase Postgres. Supabase Auth is no longer used by the app for new sign-ins; the database remains protected by Supabase Row Level Security (RLS).

## Configure the providers

1. In Firebase Console, enable Email/Password and Google under Authentication > Sign-in method. Add `localhost` and your deployed Cirkitra hostname under Authorized domains.
2. Add the Firebase web app values from Project settings to `.env.local` as `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, and `NEXT_PUBLIC_FIREBASE_APP_ID`.
3. Create a Firebase service account and add its `client_email` and `private_key` to `.env.local` as `FIREBASE_CLIENT_EMAIL` and `FIREBASE_PRIVATE_KEY`. These values must remain server-only and must never use the `NEXT_PUBLIC_` prefix.
4. In Supabase, enable Firebase under Authentication > Third-Party Auth and enter the Firebase project ID. Cirkitra adds the required `role: authenticated` claim to verified Firebase users.
5. Keep `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env.local`. Add the Supabase `service_role` key as `SUPABASE_SERVICE_ROLE_KEY`; it is only used server-side to link legacy accounts and read an owner-scoped project for the workbench.

## Apply the database migrations

Run these files in order in the Supabase SQL Editor:

1. `migrations/20261005000000_accounts_and_projects.sql` if it has not already been run.
2. `migrations/20261005010000_firebase_auth.sql` to switch ownership checks to Firebase UIDs and safely link existing rows by verified email.
3. Run the applicable AI/billing migrations in timestamp order, including `migrations/20261009080000_paypal_environment_isolation.sql` before enabling Live billing. Paste each new migration into Supabase SQL Editor as a new query; do not replace an older migration or edit historical rows manually.

The second migration preserves existing project/settings rows. When a Firebase user confirms an email matching an existing Supabase Auth account, the server-only migration function moves that account's row ownership to the Firebase UID. Users must create or sign into a Firebase account; Supabase passwords are not transferred.

The public site remains accessible without an account. The workbench, project library, compile endpoint, and AI-generation endpoint require a verified Firebase session. Supabase RLS independently restricts database access to the Firebase UID in the verified token.

## PayPal Live on Vercel

Live billing is intentionally opt-in. Existing Sandbox intents, subscriptions, and webhook events are retained and marked `sandbox`; they do not grant Live access or block a Live checkout. Admin plan grants remain environment-independent.

In PayPal’s **Live** app, create two distinct active subscription plans: Maker at USD $10 every month and Pro at USD $20 every month. Create a Live webhook for the production URL `https://<your-production-domain>/api/billing/paypal/webhook` and subscribe it to the nine event types listed in `lib/billing/paypal-live-preflight.ts`. Copy the Live client ID, secret, plan IDs, and webhook ID into Vercel; never commit them or paste them into chat.

In Vercel Project Settings > Environment Variables, scope the same variable names separately:

- **Production:** `PAYPAL_ENV=live`, Live credentials and plan/webhook IDs. Initially keep `CIRKITRA_PAYPAL_ENABLED=false` and `CIRKITRA_PAYPAL_LIVE_BILLING_CONFIRMED=false`.
- **Preview and Development:** `PAYPAL_ENV=sandbox` and Sandbox credentials and IDs. Keep the Live confirmation false.
- Set `CIRKITRA_PAYPAL_API_ACCESS_CONFIRMED=true` only after the relevant PayPal app and Subscriptions API access are verified. Pro is unavailable when its plan ID is missing or duplicates Maker’s.

Make sure Vercel’s **Automatically expose System Environment Variables** setting is on. Runtime checkout also requires both `NODE_ENV=production` and `VERCEL_ENV=production`; local and Preview deployments cannot use Live checkout.

After adding the Live variables to Production, run the no-charge read-only check from this linked project:

```bash
vercel env run -e production -- npm run paypal:preflight -- --live
```

The preflight authenticates with the Live API and reads both plans and the configured Live webhook. It requires active, unlimited monthly cycles priced at exactly $10/$20 USD with no trial/upfront setup fee, and checks the webhook URL and required event subscriptions. It does not create a subscription or charge anyone. Fix any failed checks before continuing.

Then apply the migrations, deploy once with checkout still disabled, and verify the production site’s pricing/status behavior. Only after that should you set `CIRKITRA_PAYPAL_ENABLED=true` and `CIRKITRA_PAYPAL_LIVE_BILLING_CONFIRMED=true` in **Production** and redeploy. Preview/Development remain Sandbox. This code change does not itself modify Vercel settings, apply a remote migration, deploy, or run a paid smoke test.
