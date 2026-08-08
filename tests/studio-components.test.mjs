import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const studioUrl = new URL("../app/studio.tsx", import.meta.url);

test("Arduino Uno is visible in the component library", async () => {
  const source = await readFile(studioUrl, "utf8");
  const partsFactory = source.match(
    /const parts = useMemo\([\s\S]*?\}, \[paletteCategory, paletteSearch\]\);/,
  )?.[0];

  assert.ok(partsFactory, "component library factory should be present");
  assert.match(partsFactory, /SUPPORTED_COMPONENT_TYPES\s*\n?\s*\.map/);
  assert.doesNotMatch(partsFactory, /arduino-uno/);
  assert.match(source, /boards: "Boards"/);
  assert.doesNotMatch(source, /SUPPORTED_COMPONENT_TYPES\.length\s*-\s*1/);
});

test("Arduino Uno uses the ordinary component removal path", async () => {
  const source = await readFile(studioUrl, "utf8");

  assert.match(source, /removeComponentFromProject\(current, componentId\)/);
  assert.match(source, /removeComponent\(selected\.(?:id)|selectedId\)/);
  assert.match(source, /removeComponent\(selected\.id\)/);
  assert.doesNotMatch(source, /selected\.type\s*!==\s*"arduino-uno"/);
  assert.doesNotMatch(
    source,
    /component\.id\s*!==\s*selectedId\s*\|\|\s*component\.type\s*===\s*"arduino-uno"/,
  );
});

test("AI-generated layouts are centered on origin and fitted immediately", async () => {
  const source = await readFile(studioUrl, "utf8");
  const submitPrompt = source.match(
    /const submitPrompt = async[\s\S]*?\n  };\n\n  const exportProject/,
  )?.[0];

  assert.ok(submitPrompt, "submitPrompt implementation should be present");
  assert.match(
    submitPrompt,
    /components: centerComponentsAtOrigin\(parsed\.data\.components\)/,
  );
  assert.match(submitPrompt, /fitComponentsInCanvas\(nextProject\.components\)/);
  assert.match(submitPrompt, /setPendingPin\(null\)/);
});

test("Gemini model selection defaults, persists, and is sent with prompts", async () => {
  const source = await readFile(studioUrl, "utf8");

  assert.match(source, /const DEFAULT_GEMINI_MODEL[^=]*=\s*"gemini-3\.5-flash"/);
  assert.match(source, /"gemini-3\.5-flash-lite"/);
  assert.match(source, /localStorage\.getItem\(MODEL_STORAGE_KEY\)/);
  assert.match(source, /localStorage\.setItem\(MODEL_STORAGE_KEY, nextModel\)/);
  assert.match(source, /JSON\.stringify\(\{ prompt: clean, currentProject: project, model: aiModel \}\)/);
  assert.match(source, /aria-label="Circuit generation model"/);
  assert.match(source, /AI CIRCUIT PLANNER/);
  assert.match(source, /"gemini-3\.5-flash": "Gemini 3\.5 Flash"/);
  assert.doesNotMatch(source, />\s*GEMINI CIRCUIT PLANNER/);
  assert.doesNotMatch(source, /sent to Gemini|Gemini generation failed/);
  assert.doesNotMatch(source, /AI-generated circuits only/);
});

test("canvas marquee selects and deletes multiple components", async () => {
  const source = await readFile(studioUrl, "utf8");

  assert.match(source, /type MarqueeState/);
  assert.match(source, /className="selection-marquee"/);
  assert.match(source, /setSelectedIds\(nextSelectedIds\)/);
  assert.match(source, /removeSelectedComponents/);
  assert.match(source, /removeComponentsFromProject\(current, existingIds\)/);
  assert.match(source, /Delete removes all/);
});

test("select all and bulk delete work even when a canvas button has focus", async () => {
  const source = await readFile(studioUrl, "utf8");

  assert.match(source, /const selectAllComponents = useCallback/);
  assert.match(source, /projectRef\.current\.components\.map\(\(component\) => component\.id\)/);
  assert.match(source, /event\.key\.toLowerCase\(\) === "a"/);
  assert.match(source, /if \(!editing && \(event\.key === "Delete" \|\| event\.key === "Backspace"\)/);
  assert.doesNotMatch(source, /if \(!interactive && \(event\.key === "Delete" \|\| event\.key === "Backspace"\)/);
});

test("pan mode still allows components to be dragged", async () => {
  const source = await readFile(studioUrl, "utf8");
  const beginDrag = source.match(
    /const beginDrag = \(event: ReactPointerEvent, component: CircuitComponent\) => \{[\s\S]*?\n  \};/,
  )?.[0];

  assert.ok(beginDrag, "component drag handler should be present");
  assert.doesNotMatch(beginDrag, /canvasTool\s*===\s*"pan"/);
  assert.match(beginDrag, /setDragState/);
  assert.match(source, /Drag empty canvas to pan, or drag a component to move it/);
});
