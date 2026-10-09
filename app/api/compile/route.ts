import { compileArduinoSketch } from "../../../lib/simulator/index.ts";
import { isBoardType } from "../../../lib/circuit/boards.ts";
import { authenticateAiRequest } from "../../../lib/billing/ai-usage.ts";
import { readBoundedJson } from "../../../lib/http/bounded-json.ts";

export const runtime = "nodejs";

const MAX_COMPILE_BODY_BYTES = 128_000;

type CompileDiagnostic = {
  line: number;
  column: number;
  severity: "error" | "warning";
  message: string;
};

function lineOf(source: string, index: number) {
  return source.slice(0, Math.max(0, index)).split("\n").length;
}

function validateSketch(code: string): CompileDiagnostic[] {
  const diagnostics: CompileDiagnostic[] = [];

  if (!/\bvoid\s+setup\s*\(\s*\)/.test(code)) {
    diagnostics.push({ line: 1, column: 1, severity: "error", message: "Sketch must define void setup()." });
  }
  if (!/\bvoid\s+loop\s*\(\s*\)/.test(code)) {
    diagnostics.push({ line: 1, column: 1, severity: "error", message: "Sketch must define void loop()." });
  }

  const stack: { char: string; index: number }[] = [];
  const pairs: Record<string, string> = { "}": "{", ")": "(", "]": "[" };
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < code.length; index += 1) {
    const char = code[index];
    const next = code[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") { blockComment = false; index += 1; }
      continue;
    }
    if (quote) {
      if (char === "\\") index += 1;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") { lineComment = true; index += 1; continue; }
    if (char === "/" && next === "*") { blockComment = true; index += 1; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if ("{([".includes(char)) stack.push({ char, index });
    if ("})]".includes(char)) {
      const open = stack.pop();
      if (!open || open.char !== pairs[char]) {
        diagnostics.push({ line: lineOf(code, index), column: 1, severity: "error", message: `Unexpected '${char}'.` });
        break;
      }
    }
  }

  for (const open of stack.slice(-3)) {
    diagnostics.push({ line: lineOf(code, open.index), column: 1, severity: "error", message: `Unclosed '${open.char}'.` });
  }

  for (const match of code.matchAll(/\b(attachInterrupt|shiftOut)\s*\(/g)) {
    diagnostics.push({
      line: lineOf(code, match.index ?? 0),
      column: 1,
      severity: "warning",
      message: `${match[1]}() works on hardware but is not simulated in this browser runtime yet.`,
    });
  }

  return diagnostics;
}

export async function POST(request: Request) {
  const userId = await authenticateAiRequest(request);
  if (!userId) return Response.json({ error: { code: "AUTH_REQUIRED", message: "Sign in with a verified account to compile a sketch." } }, { status: 401, headers: { "Cache-Control": "no-store" } });

  const parsed = await readBoundedJson(request, MAX_COMPILE_BODY_BYTES);
  if (!parsed.ok) {
    if (parsed.reason === "too-large") return Response.json({ error: { code: "REQUEST_TOO_LARGE", message: "Compile request is too large." } }, { status: 413 });
    if (parsed.reason === "invalid-content-type") return Response.json({ error: { code: "INVALID_CONTENT_TYPE", message: "Request body must be JSON." } }, { status: 415 });
    return Response.json({ error: { code: "INVALID_JSON", message: "Request body must be valid JSON." } }, { status: 400 });
  }
  const body = parsed.value && typeof parsed.value === "object" && !Array.isArray(parsed.value)
    ? parsed.value as { code?: unknown; board?: unknown }
    : {};

  if (typeof body.board !== "string" || !isBoardType(body.board) || typeof body.code !== "string") {
    return Response.json(
      { error: { code: "INVALID_SKETCH", message: "board must be a supported board id and code must be a string." } },
    { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (body.code.length > 100_000) {
    return Response.json({ error: { code: "SKETCH_TOO_LARGE", message: "Sketch exceeds the 100 KB limit." } }, { status: 413, headers: { "Cache-Control": "no-store" } });
  }

  const diagnostics = validateSketch(body.code);
  const simulation = compileArduinoSketch(body.code, body.board);
  for (const diagnostic of simulation.diagnostics) {
    const duplicate = diagnostics.some((item) => item.line === (diagnostic.line ?? 1) && item.message === diagnostic.message);
    if (!duplicate) diagnostics.push({
      line: diagnostic.line ?? 1,
      column: diagnostic.column ?? 1,
      severity: diagnostic.severity,
      message: diagnostic.message,
    });
  }
  const success = diagnostics.every((item) => item.severity !== "error");
  return Response.json({
    success,
    mode: "simulation-ir",
    diagnostics,
    artifact: success
      ? {
          board: body.board,
          sourceBytes: new TextEncoder().encode(body.code).byteLength,
          compiledAt: new Date().toISOString(),
        }
      : null,
  }, { headers: { "Cache-Control": "no-store" } });
}
