import assert from "node:assert/strict";
import test from "node:test";

import { getVerifiedPayPalPaymentPeriod, getVerifiedPayPalPlanPaymentPeriod } from "./paypal-verification.ts";

const now = Date.parse("2026-10-08T12:00:00.000Z");
const paidDetails = {
  status: "ACTIVE",
  billing_info: {
    outstanding_balance: { currency_code: "USD", value: "0.00" },
    last_payment: {
      amount: { currency_code: "USD", value: "10.00" },
      time: "2026-10-08T11:59:00.000Z",
    },
    next_billing_time: "2026-11-08T11:59:00.000Z",
  },
};

test("PayPal confirmation requires a live paid period and the full expected USD payment", () => {
  assert.deepEqual(getVerifiedPayPalPaymentPeriod(paidDetails, 1000, now), {
    paidAt: "2026-10-08T11:59:00.000Z",
    paidThrough: "2026-11-08T11:59:00.000Z",
  });
  assert.equal(getVerifiedPayPalPaymentPeriod({ ...paidDetails, status: "APPROVED" }, 1000, now), null);
  assert.equal(getVerifiedPayPalPaymentPeriod({
    ...paidDetails,
    billing_info: { ...paidDetails.billing_info, last_payment: { ...paidDetails.billing_info.last_payment, amount: { currency_code: "USD", value: "0.00" } } },
  }, 1000, now), null);
});

test("a cancelled subscription retains a verified period that was already paid", () => {
  assert.deepEqual(getVerifiedPayPalPaymentPeriod({ ...paidDetails, status: "CANCELLED" }, 1000, now), {
    paidAt: "2026-10-08T11:59:00.000Z",
    paidThrough: "2026-11-08T11:59:00.000Z",
  });
  assert.equal(getVerifiedPayPalPaymentPeriod({ ...paidDetails, status: "CANCELLED", billing_info: { ...paidDetails.billing_info, last_payment: null } }, 1000, now), null);
});

test("PayPal confirmation requires the exact expected amount", () => {
  const proDetails = {
    ...paidDetails,
    billing_info: {
      ...paidDetails.billing_info,
      last_payment: {
        ...paidDetails.billing_info.last_payment,
        amount: { currency_code: "USD", value: "20.00" },
      },
    },
  };
  assert.deepEqual(getVerifiedPayPalPaymentPeriod(proDetails, 2000, now), {
    paidAt: "2026-10-08T11:59:00.000Z",
    paidThrough: "2026-11-08T11:59:00.000Z",
  });
  assert.equal(getVerifiedPayPalPaymentPeriod(proDetails, 1000, now), null);
  assert.equal(getVerifiedPayPalPaymentPeriod(paidDetails, 2000, now), null);
});

function withAmount(value: string) {
  return {
    ...paidDetails,
    billing_info: {
      ...paidDetails.billing_info,
      last_payment: { ...paidDetails.billing_info.last_payment, amount: { currency_code: "USD", value } },
    },
  };
}

test("plan reconciliation verifies the reduced Maker and Pro prices", () => {
  assert.ok(getVerifiedPayPalPlanPaymentPeriod(withAmount("5.00"), "maker", now));
  assert.ok(getVerifiedPayPalPlanPaymentPeriod(withAmount("10.00"), "pro", now));
  assert.equal(getVerifiedPayPalPlanPaymentPeriod(withAmount("5.00"), "pro", now), null);
  assert.equal(getVerifiedPayPalPlanPaymentPeriod(withAmount("4.99"), "maker", now), null);
  assert.equal(getVerifiedPayPalPlanPaymentPeriod(withAmount("9.99"), "pro", now), null);
});

test("plan reconciliation preserves old paid periods only at the exact previous tier price", () => {
  assert.ok(getVerifiedPayPalPlanPaymentPeriod(withAmount("10.00"), "maker", now));
  assert.ok(getVerifiedPayPalPlanPaymentPeriod(withAmount("20.00"), "pro", now));
  assert.equal(getVerifiedPayPalPlanPaymentPeriod(withAmount("20.00"), "maker", now), null);
  assert.equal(getVerifiedPayPalPlanPaymentPeriod(withAmount("15.00"), "pro", now), null);
  assert.equal(getVerifiedPayPalPlanPaymentPeriod(withAmount("100.00"), "maker", now), null);
});

test("previous price compatibility still rejects unpaid, expired, wrong-currency, or indebted periods", () => {
  assert.equal(getVerifiedPayPalPlanPaymentPeriod({ ...paidDetails, status: "APPROVED" }, "maker", now), null);
  assert.equal(getVerifiedPayPalPlanPaymentPeriod({ ...paidDetails, billing_info: { ...paidDetails.billing_info, last_payment: null } }, "maker", now), null);
  assert.equal(getVerifiedPayPalPlanPaymentPeriod({ ...paidDetails, billing_info: { ...paidDetails.billing_info, next_billing_time: "2026-10-08T11:00:00.000Z" } }, "maker", now), null);
  assert.equal(getVerifiedPayPalPlanPaymentPeriod({ ...paidDetails, billing_info: { ...paidDetails.billing_info, outstanding_balance: { currency_code: "USD", value: "1.00" } } }, "maker", now), null);
  assert.equal(getVerifiedPayPalPlanPaymentPeriod({ ...paidDetails, billing_info: { ...paidDetails.billing_info, last_payment: { ...paidDetails.billing_info.last_payment, amount: { currency_code: "EUR", value: "10.00" } } } }, "maker", now), null);
});

test("PayPal confirmation rejects an unpaid, incomplete, expired, or wrong-currency period", () => {
  assert.equal(getVerifiedPayPalPaymentPeriod({ ...paidDetails, billing_info: { ...paidDetails.billing_info, outstanding_balance: { currency_code: "USD", value: "10.00" } } }, 1000, now), null);
  assert.equal(getVerifiedPayPalPaymentPeriod({ ...paidDetails, billing_info: { ...paidDetails.billing_info, last_payment: null } }, 1000, now), null);
  assert.equal(getVerifiedPayPalPaymentPeriod({ ...paidDetails, billing_info: { ...paidDetails.billing_info, next_billing_time: "2026-10-08T11:00:00.000Z" } }, 1000, now), null);
  assert.equal(getVerifiedPayPalPaymentPeriod({
    ...paidDetails,
    billing_info: { ...paidDetails.billing_info, last_payment: { ...paidDetails.billing_info.last_payment, amount: { currency_code: "EUR", value: "10.00" } } },
  }, 1000, now), null);
});
