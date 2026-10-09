import { runPayPalLivePreflight } from "../lib/billing/paypal-live-preflight.ts";

if (!process.argv.includes("--live")) {
  throw new Error("Refusing to run: pass --live to explicitly select PayPal Live preflight.");
}
if (process.env.PAYPAL_ENV?.trim().toLowerCase() !== "live") {
  throw new Error("Refusing to run: PAYPAL_ENV must be live. No request was sent to PayPal.");
}

try {
  const result = await runPayPalLivePreflight({
    clientId: process.env.PAYPAL_CLIENT_ID ?? "",
    clientSecret: process.env.PAYPAL_CLIENT_SECRET ?? "",
    makerPlanId: process.env.PAYPAL_PLAN_ID ?? "",
    proPlanId: process.env.PAYPAL_PRO_PLAN_ID ?? "",
    webhookId: process.env.PAYPAL_WEBHOOK_ID ?? "",
  });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : "PayPal Live preflight failed.",
  }, null, 2));
  process.exitCode = 1;
}
