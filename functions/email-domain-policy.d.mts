export const ALLOWED_EMAIL_DOMAINS: readonly string[];
export const EMAIL_DOMAIN_BLOCK_MESSAGE: string;
export function getEmailDomain(email: unknown): string | null;
export function isAllowedEmailAddress(email: unknown): boolean;
