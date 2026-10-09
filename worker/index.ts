/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { applySecurityHeaders, createContentSecurityPolicy, createCspNonce } from "../lib/security/headers";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  NODE_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const nonce = createCspNonce();
    const production = env.NODE_ENV !== "development";
    const options = { nonce, supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL, production };
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("Content-Security-Policy", createContentSecurityPolicy(options));
    requestHeaders.set("x-nonce", nonce);
    const securedRequest = new Request(request, { headers: requestHeaders });
    const url = new URL(securedRequest.url);
    let response: Response;

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      response = await handleImageOptimization(securedRequest, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    } else {
      response = await handler.fetch(securedRequest, env, ctx);
    }

    if (response.status === 101) return response;
    const responseHeaders = new Headers(response.headers);
    applySecurityHeaders(responseHeaders, options);
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  },
};

export default worker;
