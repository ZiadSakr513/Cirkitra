import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const studioUrl = new URL("../app/studio.tsx", import.meta.url);

test("prompt generation never falls back to a predefined circuit or reply", async () => {
  const source = await readFile(studioUrl, "utf8");
  const submitPrompt = source.match(
    /const submitPrompt = async[\s\S]*?\n  };\n\n  const exportProject/,
  )?.[0];

  assert.ok(submitPrompt, "submitPrompt implementation should be present");
  assert.doesNotMatch(source, /createDemoFromPrompt|createTrafficLightProject|createBuzzerProject/);
  assert.doesNotMatch(source, /Local planner|offline-safe|local circuit generated/i);
  assert.doesNotMatch(source, /const initialChat/);
  assert.doesNotMatch(source, /Groq|GROQ/);

  assert.equal(
    submitPrompt.match(/commitProject\(nextProject\)/g)?.length,
    1,
    "only the validated Gemini success path may replace the project",
  );
  const failurePath = submitPrompt.split("} catch (error) {")[1] ?? "";
  assert.doesNotMatch(failurePath, /commitProject|simulator\.load|role: "assistant"/);
  assert.match(failurePath, /current circuit unchanged/i);
});
