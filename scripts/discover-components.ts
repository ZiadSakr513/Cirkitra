import { readFile } from "node:fs/promises";
import { discoverLibraryCandidates } from "../lib/circuit/discovery.ts";

const [file, ...terms] = process.argv.slice(2);
if (!file || !terms.join(" ").trim()) {
  console.error("Usage: npm run catalog:discover -- <library_index.json> <search terms>");
  process.exitCode = 1;
} else {
  const index = JSON.parse(await readFile(file, "utf8"));
  if (!Array.isArray(index.libraries) || index.libraries.some((item: unknown) => !item || typeof item !== "object" || !("name" in item) || typeof item.name !== "string")) {
    throw new Error("Expected a Library Manager index with a libraries array of named entries.");
  }
  console.log(JSON.stringify({ status: "review-only", candidates: discoverLibraryCandidates(index, terms.join(" ")) }, null, 2));
}
