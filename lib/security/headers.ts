export type SecurityHeaderOptions = {
  nonce: string;
  supabaseUrl?: string;
  production?: boolean;
};

function validOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function createCspNonce() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(18));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function createContentSecurityPolicy({ nonce, supabaseUrl, production = false }: SecurityHeaderOptions) {
  const supabaseOrigin = validOrigin(supabaseUrl);
  const supabaseWsOrigin = supabaseOrigin?.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const connectSources = [
    "'self'",
    "https://identitytoolkit.googleapis.com",
    "https://securetoken.googleapis.com",
    "https://firebaseinstallations.googleapis.com",
    "https://www.googleapis.com",
    "https://oauth2.googleapis.com",
    "https://accounts.google.com",
    "https://www.google.com",
    "https://paypal.com",
    "https://www.paypal.com",
    "https://www.sandbox.paypal.com",
    "https://*.paypal.com",
    "https://*.paypalobjects.com",
    "https://www.paypalobjects.com",
    "https://api-m.paypal.com",
    "https://api-m.sandbox.paypal.com",
    "https://vitals.vercel-insights.com",
    ...(supabaseOrigin ? [supabaseOrigin] : []),
    ...(supabaseWsOrigin ? [supabaseWsOrigin] : []),
    ...(!production ? ["ws://localhost:*", "ws://127.0.0.1:*", "http://localhost:*"] : []),
  ];
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' https://www.paypal.com https://www.sandbox.paypal.com https://www.gstatic.com https://accounts.google.com https://apis.google.com https://va.vercel-scripts.com${production ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https://www.paypalobjects.com https://*.paypalobjects.com https://www.gstatic.com https://*.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    "frame-src 'self' https://paypal.com https://*.paypal.com https://*.paypalobjects.com https://accounts.google.com https://*.firebaseapp.com",
    "worker-src 'self' blob:",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self' https://paypal.com https://*.paypal.com https://accounts.google.com",
    "frame-ancestors 'none'",
    ...(production ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

export function createSecurityHeaders(options: SecurityHeaderOptions) {
  const production = options.production ?? process.env.NODE_ENV === "production";
  return {
    "Content-Security-Policy": createContentSecurityPolicy({ ...options, production }),
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), browsing-topics=()",
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "X-DNS-Prefetch-Control": "off",
    ...(production ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
  } satisfies Record<string, string>;
}

export function applySecurityHeaders(headers: Headers, options: SecurityHeaderOptions) {
  for (const [name, value] of Object.entries(createSecurityHeaders(options))) headers.set(name, value);
  return headers;
}
