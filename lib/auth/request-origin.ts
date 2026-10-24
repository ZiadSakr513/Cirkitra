function normalizedOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isLoopback(hostname: string) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function originForHost(host: string | null, protocol: string) {
  if (!host || /[\s/@?#\\]/.test(host)) return null;
  try {
    const url = new URL(`${protocol}//${host}`);
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Validates Origin against the request URL or HTTP Host; forwarded headers are not trusted. */
export function isSameOriginRequest(request: Request) {
  const origin = normalizedOrigin(request.headers.get("origin"));
  if (!origin) return false;

  let requestUrl: URL;
  try {
    requestUrl = new URL(request.url);
  } catch {
    return false;
  }

  if (origin === requestUrl.origin) return true;

  // Some local reverse proxies hand Next.js an internal request URL while
  // preserving the browser-facing Host header. Compare against that authority
  // too; unlike X-Forwarded-* headers, Host is part of the actual HTTP request.
  if (origin === originForHost(request.headers.get("host"), requestUrl.protocol)) return true;

  try {
    const originUrl = new URL(origin);
    const requestPort = requestUrl.port || (requestUrl.protocol === "https:" ? "443" : "80");
    const originPort = originUrl.port || (originUrl.protocol === "https:" ? "443" : "80");
    return requestUrl.protocol === originUrl.protocol
      && requestPort === originPort
      && isLoopback(requestUrl.hostname)
      && isLoopback(originUrl.hostname);
  } catch {
    return false;
  }
}
