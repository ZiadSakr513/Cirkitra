"use client";

import { useRef, useState, type FormEvent } from "react";

import { CIRKITRA_PLANS, type CirkitraPlanId, type PaidCirkitraPlanId } from "../../../lib/billing/plans";
import type { AdminPlanGrantRecord } from "../../../lib/billing/admin-plan-grants";
import type { AdminAiUsageResetRecord } from "../../../lib/billing/admin-ai-usage";
import type { AiUsageSnapshot } from "../../../lib/billing/ai-usage";
import type { PayPalBillingStatus } from "../../../lib/billing/paypal-store";

type AccountLookup = {
  account: { uid: string; email: string; displayName: string | null; emailVerified: boolean };
  billing: PayPalBillingStatus;
  grants: AdminPlanGrantRecord[];
  serverNow: string;
};

type AdminAiUsageLookup = {
  usage: AiUsageSnapshot;
  resets: AdminAiUsageResetRecord[];
  serverNow: string;
};

function formatDate(value: string | null) {
  if (!value) return "No expiration";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function grantState(grant: AdminPlanGrantRecord, now: number) {
  if (grant.revoked_at) return "Revoked";
  if (Date.parse(grant.starts_at) > now) return "Scheduled";
  if (grant.expires_at && Date.parse(grant.expires_at) <= now) return "Expired";
  return "Active";
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || "The request could not be completed.");
  return body as T;
}

export function AdminPlanManager() {
  const [email, setEmail] = useState("");
  const [account, setAccount] = useState<AccountLookup | null>(null);
  const [aiUsage, setAiUsage] = useState<AdminAiUsageLookup | null>(null);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageError, setUsageError] = useState("");
  const [resetNote, setResetNote] = useState("");
  const [planId, setPlanId] = useState<PaidCirkitraPlanId>("maker");
  const [expiresOn, setExpiresOn] = useState("");
  const [neverExpires, setNeverExpires] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pendingResetKeys = useRef(new Map<string, string>());

  async function lookupAccount(lookupEmail: string) {
    const response = await fetch(`/api/admin/plan-grants?email=${encodeURIComponent(lookupEmail)}`, { cache: "no-store", credentials: "same-origin" });
    return await readJson<AccountLookup>(response);
  }

  async function lookupUsage(lookupEmail: string) {
    const response = await fetch(`/api/admin/ai-usage?email=${encodeURIComponent(lookupEmail)}`, { cache: "no-store", credentials: "same-origin" });
    return await readJson<AdminAiUsageLookup>(response);
  }

  async function refreshUsage(lookupEmail: string) {
    setUsageLoading(true);
    setUsageError("");
    try {
      setAiUsage(await lookupUsage(lookupEmail));
    } catch (cause) {
      setAiUsage(null);
      setUsageError(cause instanceof Error ? cause.message : "Could not load AI usage.");
    } finally {
      setUsageLoading(false);
    }
  }

  async function searchAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) return;
    setBusy(true);
    setError("");
    setNotice("");
    setAccount(null);
    setAiUsage(null);
    setUsageError("");
    setResetNote("");
    try {
      setAccount(await lookupAccount(normalizedEmail));
      setEmail(normalizedEmail);
      await refreshUsage(normalizedEmail);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not find that account.");
    } finally {
      setBusy(false);
    }
  }

  async function grantPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let expiresAt: string | null | undefined;
      if (neverExpires) {
        expiresAt = null;
      } else if (expiresOn) {
        const [year, month, day] = expiresOn.split("-").map(Number);
        const localEndOfDay = new Date(year, month - 1, day, 23, 59, 59, 999);
        if (!Number.isFinite(localEndOfDay.getTime()) || localEndOfDay.getTime() <= Date.now()) {
          throw new Error("Expiration must be a future date.");
        }
        expiresAt = localEndOfDay.toISOString();
      }
      const grantRequest: { email: string; planId: PaidCirkitraPlanId; expiresAt?: string | null; note: string } = {
        email: account.account.email,
        planId,
        note,
      };
      if (expiresAt !== undefined) grantRequest.expiresAt = expiresAt;
      const response = await fetch("/api/admin/plan-grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(grantRequest),
      });
      await readJson<{ grant: AdminPlanGrantRecord }>(response);
      setAccount(await lookupAccount(account.account.email));
      await refreshUsage(account.account.email);
      setNotice(`${CIRKITRA_PLANS[planId].name} access granted. No PayPal payment or subscription was created.`);
      setNote("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not grant this plan.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeGrant(grantId: string) {
    if (!account || !window.confirm("Revoke this complimentary access now? This does not change any PayPal subscription.")) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/admin/plan-grants/${encodeURIComponent(grantId)}`, {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
      });
      await readJson<{ revoked: boolean }>(response);
      setAccount(await lookupAccount(account.account.email));
      await refreshUsage(account.account.email);
      setNotice("Complimentary access revoked. Any valid PayPal plan remains unchanged.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke this grant.");
    } finally {
      setBusy(false);
    }
  }

  async function resetUsage() {
    if (!account || !aiUsage || aiUsage.usage.unlimited) return;
    const usage = aiUsage.usage;
    const confirmed = window.confirm(
      `Reset ${account.account.email}'s AI circuit-generation usage? They will immediately have the full ${usage.limit}-request allowance for their current ${usage.planName} plan. Their plan, grant, and PayPal subscription will not change. Previous request records will be kept but will no longer count.`,
    );
    if (!confirmed) return;

    const note = resetNote.trim();
    const operationKey = `${account.account.email}\u0000${note}`;
    let idempotencyKey = pendingResetKeys.current.get(operationKey);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      pendingResetKeys.current.set(operationKey, idempotencyKey);
    }

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/admin/ai-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify({ email: account.account.email, idempotencyKey, note }),
      });
      const result = await readJson<AdminAiUsageLookup & { reset: AdminAiUsageResetRecord }>(response);
      setAiUsage(result);
      pendingResetKeys.current.delete(operationKey);
      setResetNote("");
      setNotice(`Usage reset. ${result.usage.remaining} of ${result.usage.limit} AI circuit requests are available under ${result.usage.planName}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not reset AI usage.");
    } finally {
      setBusy(false);
    }
  }

  const effectivePlan: CirkitraPlanId | null = account?.billing.planId ?? null;

  return <div className="admin-plan-manager">
    <form className="admin-plan-search" onSubmit={(event) => void searchAccount(event)}>
      <label htmlFor="admin-account-email">Account email</label>
      <div className="admin-plan-search-row">
        <input
          id="admin-account-email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => { setEmail(event.target.value); setAccount(null); setAiUsage(null); setUsageError(""); setResetNote(""); setNotice(""); }}
          placeholder="person@example.com"
        />
        <button className="projects-create" type="submit" disabled={busy}>{busy ? "Loading…" : "Find account"}</button>
      </div>
    </form>

    {error && <p className="admin-plan-alert" role="alert">{error}</p>}
    {notice && <p className="admin-plan-notice" role="status">{notice}</p>}

    {account && effectivePlan && <section className="admin-plan-account" aria-label="Account plan details">
      <div className="admin-plan-account-heading">
        <div>
          <span className="admin-plan-kicker">ACCOUNT</span>
          <h2>{account.account.displayName || account.account.email}</h2>
          <p>{account.account.email} · {account.account.emailVerified ? "Email verified" : "Email not verified"}</p>
        </div>
        <div className="admin-plan-effective">
          <span>Effective access</span>
          <strong>{CIRKITRA_PLANS[effectivePlan].name}</strong>
          <small>{CIRKITRA_PLANS[effectivePlan].monthlyAiRequests} AI requests per rolling month</small>
        </div>
      </div>

      <div className="admin-plan-sources">
        <p><strong>PayPal plan:</strong> {account.billing.paypalPlanId === "free" ? "None active" : `${CIRKITRA_PLANS[account.billing.paypalPlanId].name} through ${formatDate(account.billing.paidThrough)}`}{account.billing.subscriptionStatus ? ` · ${account.billing.subscriptionStatus}` : ""}</p>
        <p><strong>Complimentary grant:</strong> {account.billing.complimentaryGrant ? `${CIRKITRA_PLANS[account.billing.complimentaryGrant.planId].name} until ${formatDate(account.billing.complimentaryGrant.expiresAt)}` : "None active"}</p>
      </div>

      <section className="admin-plan-usage" aria-label="AI circuit-generation usage">
        <div className="admin-plan-usage-heading">
          <div>
            <h3>AI circuit-generation usage</h3>
            <p>Failed generations do not count. Chat has a separate limit.</p>
          </div>
          {usageLoading && <span>Loading…</span>}
        </div>
        {usageError && <p className="admin-plan-alert" role="alert">{usageError}</p>}
        {aiUsage && <>
          {aiUsage.usage.unlimited ? <p className="admin-plan-usage-unlimited">This owner account has unlimited access; there is no usage limit to reset.</p> : <>
            <div className="admin-plan-usage-summary">
              <strong>{aiUsage.usage.used} of {aiUsage.usage.limit} used</strong>
              <span>{aiUsage.usage.remaining} available</span>
            </div>
            <div className="admin-plan-usage-meter" role="progressbar" aria-label="AI circuit-generation requests used" aria-valuemin={0} aria-valuemax={aiUsage.usage.limit} aria-valuenow={Math.min(aiUsage.usage.used, aiUsage.usage.limit)}>
              <span style={{ width: `${aiUsage.usage.limit ? Math.min(100, (aiUsage.usage.used / aiUsage.usage.limit) * 100) : 0}%` }} />
            </div>
            <p className="admin-plan-usage-reset-date">{aiUsage.usage.resetsAt ? `Next request slot opens ${formatDate(aiUsage.usage.resetsAt)}.` : "No requests are currently counting toward this rolling month."}</p>
            <label className="admin-plan-reset-note">Internal note (optional)
              <textarea value={resetNote} maxLength={1000} onChange={(event) => setResetNote(event.target.value)} placeholder="Reason for this usage reset" rows={2} />
            </label>
            <button className="admin-plan-reset" type="button" disabled={busy || usageLoading} onClick={() => void resetUsage()}>
              {busy ? "Saving…" : "Reset usage"}
            </button>
          </>}
          <div className="admin-plan-reset-history">
            <h4>Recent usage reset history</h4>
            {aiUsage.resets.length === 0 ? <p className="admin-plan-empty">No resets for this account.</p> : <ul>
              {aiUsage.resets.map((reset) => <li key={reset.id}>
                <strong>Reset {formatDate(reset.reset_at)}</strong>
                <span>By admin {reset.reset_by}</span>
                {reset.internal_note && <small>{reset.internal_note}</small>}
              </li>)}
            </ul>}
          </div>
        </>}
      </section>

      <form className="admin-plan-grant-form" onSubmit={(event) => void grantPlan(event)}>
        <h3>Grant a plan</h3>
        <div className="admin-plan-form-grid">
          <label>Plan
            <select value={planId} onChange={(event) => setPlanId(event.target.value as PaidCirkitraPlanId)}>
              <option value="maker">Maker · 50 requests</option>
              <option value="pro">Pro · 200 requests</option>
            </select>
          </label>
          <label>Expires on
            <input type="date" value={expiresOn} disabled={neverExpires} onChange={(event) => setExpiresOn(event.target.value)} />
            <small className="admin-plan-help">Leave blank for the default 30-day grant.</small>
          </label>
        </div>
        <label className="admin-plan-never">
          <input type="checkbox" checked={neverExpires} onChange={(event) => setNeverExpires(event.target.checked)} />
          No expiration; access stays until revoked
        </label>
        <label>Internal note (optional)
          <textarea value={note} maxLength={1000} onChange={(event) => setNote(event.target.value)} placeholder="Reason for this complimentary access" rows={3} />
        </label>
        <button className="landing-button admin-plan-submit" type="submit" disabled={busy}>{busy ? "Saving…" : `Grant ${CIRKITRA_PLANS[planId].name}`}</button>
      </form>

      <div className="admin-plan-history">
        <h3>Grant history</h3>
        {account.grants.length === 0 ? <p className="admin-plan-empty">No complimentary grants for this account.</p> : <ul>
          {account.grants.map((grant) => {
            const state = grantState(grant, Date.parse(account.serverNow));
            return <li key={grant.id}>
              <div>
                <strong>{CIRKITRA_PLANS[grant.plan_id].name} · {state}</strong>
                <span>Granted {formatDate(grant.granted_at)} · {formatDate(grant.expires_at)}</span>
                {grant.internal_note && <small>{grant.internal_note}</small>}
              </div>
              {state === "Active" && <button className="admin-plan-revoke" type="button" disabled={busy} onClick={() => void revokeGrant(grant.id)}>Revoke</button>}
            </li>;
          })}
        </ul>}
      </div>
    </section>}
  </div>;
}
