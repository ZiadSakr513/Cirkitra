export type CirkitraPlanId = "free" | "maker" | "pro";
export type PaidCirkitraPlanId = Exclude<CirkitraPlanId, "free">;

export const CIRKITRA_PLANS = {
  free: {
    id: "free",
    name: "Free",
    priceUsdCents: 0,
    monthlyAiRequests: 5,
    description: "Design, edit, code, simulate, and save projects for free.",
  },
  maker: {
    id: "maker",
    name: "Maker",
    priceUsdCents: 1000,
    monthlyAiRequests: 50,
    description: "More AI circuit requests for personal projects.",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsdCents: 2000,
    monthlyAiRequests: 200,
    description: "Four times the Maker AI requests for bigger projects.",
  },
} as const;
export function formatMonthlyPrice(priceUsdCents: number) {
  if (priceUsdCents === 0) return "$0";

  const dollars = priceUsdCents / 100;
  return Number.isInteger(dollars) ? `$${dollars}` : `$${dollars.toFixed(2)}`;
}
