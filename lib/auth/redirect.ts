export function safeNextPath(candidate: string | null | undefined, fallback = "/projects") {
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, "https://cirkitra.invalid");
    return parsed.origin === "https://cirkitra.invalid" ? `${parsed.pathname}${parsed.search}${parsed.hash}` : fallback;
  } catch {
    return fallback;
  }
}
