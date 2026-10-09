import policy from "./email-domain-policy.json" with { type: "json" };

export const ALLOWED_EMAIL_DOMAINS = Object.freeze(
  policy.allowedDomains.map((domain) => domain.toLowerCase()),
);

export const EMAIL_DOMAIN_BLOCK_MESSAGE =
  "Email domain isn't supported.";

const allowedDomains = new Set(ALLOWED_EMAIL_DOMAINS);

export function getEmailDomain(email) {
  if (typeof email !== "string") return null;

  const normalized = email.trim();
  if (!normalized || !/^[^\s@]+@[^\s@]+$/.test(normalized)) return null;

  const separator = normalized.lastIndexOf("@");
  return normalized.slice(separator + 1).toLowerCase();
}

export function isAllowedEmailAddress(email) {
  const domain = getEmailDomain(email);
  return domain !== null && allowedDomains.has(domain);
}
