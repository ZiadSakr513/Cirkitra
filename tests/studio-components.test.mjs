import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const studioUrl = new URL("../app/studio.tsx", import.meta.url);
const symbolsUrl = new URL("../app/schematic-symbols.tsx", import.meta.url);
const symbolStylesUrl = new URL("../app/schematic-symbols.css", import.meta.url);
const globalStylesUrl = new URL("../app/globals.css", import.meta.url);

test("component category filters expose horizontal scrolling when the row overflows", async () => {
  const [studio, styles] = await Promise.all([
    readFile(studioUrl, "utf8"),
    readFile(globalStylesUrl, "utf8"),
  ]);
  const categoryRule = styles.match(/\.category-list \{([^}]+)\}/)?.[1];

  assert.ok(categoryRule, "category list styles should be present");
  assert.match(categoryRule, /min-width: 0/);
  assert.match(categoryRule, /overflow-x: auto/);
  assert.match(categoryRule, /scrollbar-width: thin/);
  assert.match(styles, /\.category-list::-webkit-scrollbar \{\s*height: 7px/);
  assert.match(styles, /\.category-list::-webkit-scrollbar-thumb \{/);
  assert.match(studio, /className="category-list" role="group"[^>]*tabIndex=\{0\}/);
});

test("schematic symbols omit wiring fault badges while simulation errors remain available", async () => {
  const [studio, symbols] = await Promise.all([
    readFile(studioUrl, "utf8"),
    readFile(symbolsUrl, "utf8"),
  ]);

  assert.doesNotMatch(studio, /Ready to simulate/);
  assert.doesNotMatch(studio, /CAPABILITY_LABELS/);
  assert.doesNotMatch(studio, /capability--\$\{simulationCapability\(part\)\}/);
  assert.doesNotMatch(symbols, /Ready to simulate/);
  assert.match(symbols, /status !== "idle" && !state\.fault/);
  assert.doesNotMatch(symbols, /state\.fault \? "Wiring fault"/);
});

test("generation failures show a concrete next step with diagnostics and safe retry", async () => {
  const studio = await readFile(studioUrl, "utf8");
  assert.match(studio, /generationFailureNextStep\(failedGeneration\?\.code, generationErrorDetails\)/);
  assert.match(studio, /className="generation-error-next-action"/);
  assert.match(studio, /Your current circuit was not changed\./);
});

test("registry symbol names wrap across words instead of into vertical letters", async () => {
  const styles = await readFile(symbolStylesUrl, "utf8");
  const nameRule = styles.match(/\.symbol-registry__body b \{([^}]+)\}/)?.[1];
  const manufacturerRule = styles.match(/\.symbol-registry__body small \{([^}]+)\}/)?.[1];

  assert.ok(nameRule, "symbol name rule should be present");
  assert.ok(manufacturerRule, "manufacturer rule should be present");
  assert.match(styles, /\.symbol-registry__body \{[^}]*padding: 4px 42px/);
  for (const rule of [nameRule, manufacturerRule]) {
    assert.match(rule, /max-width: 100%/);
    assert.match(rule, /overflow-wrap: break-word/);
    assert.match(rule, /word-break: normal/);
    assert.doesNotMatch(rule, /anywhere|break-all/);
  }
});

test("Arduino Uno pin names and terminals stay readable beside its board artwork", async () => {
  const styles = await readFile(symbolStylesUrl, "utf8");
  const labelRule = styles.match(/\.component-arduino-uno \.schematic-pin \{([^}]+)\}/)?.[1];

  assert.ok(labelRule, "Uno pin label rule should be present");
  assert.match(labelRule, /font-size: 10px/);
  assert.match(labelRule, /font-weight: 600/);
  assert.match(labelRule, /text-shadow:/);
  assert.match(styles, /\.component-arduino-uno \.schematic-pin i \{[^}]*width: 9px; height: 9px/);
  assert.match(styles, /\.component-arduino-uno \.schematic-pin\.connected i \{\s*width: 11px;\s*height: 11px/);
});

test("all registered boards render readable pin names over their board artwork", async () => {
  const [studio, styles] = await Promise.all([
    readFile(studioUrl, "utf8"),
    readFile(symbolStylesUrl, "utf8"),
  ]);

  assert.ok(studio.includes("(!definition.symbol || isBoardType(component.type)) && <span>{pin.label}</span>"));
  for (const boardType of [
    "arduino-mega-2560",
    "arduino-nano-classic",
    "esp32-devkitc-v4",
    "esp8266-nodemcu-v1",
    "raspberry-pi-pico",
  ]) {
    assert.match(styles, new RegExp(`\\.component-${boardType} \\.schematic-pin`));
  }
  assert.match(styles, /\.symbol-registry__pin \{[^}]*z-index: 6/);
});

test("Arduino Uno is visible in the component library", async () => {
  const source = (await readFile(studioUrl, "utf8")).replace(/\r\n/g, "\n");
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
  const source = (await readFile(studioUrl, "utf8")).replace(/\r\n/g, "\n");

  assert.match(source, /removeComponentFromProject\(current, componentId\)/);
  assert.match(source, /removeComponent\(selected\.(?:id)|selectedId\)/);
  assert.match(source, /removeComponent\(selected\.id\)/);
  assert.doesNotMatch(source, /selected\.type\s*!==\s*"arduino-uno"/);
  assert.doesNotMatch(
    source,
    /component\.id\s*!==\s*selectedId\s*\|\|\s*component\.type\s*===\s*"arduino-uno"/,
  );
});

test("fresh AI builds are centered and fitted while edits keep the existing canvas layout", async () => {
  const source = (await readFile(studioUrl, "utf8")).replace(/\r\n/g, "\n");
  const submitPrompt = source.match(
    /const submitPrompt = async[\s\S]*?\n  };\n\n  const exportProject/,
  )?.[0];

  assert.ok(submitPrompt, "submitPrompt implementation should be present");
  assert.match(submitPrompt, /const isEdit = result\.generationMode === "edit"/);
  assert.match(
    submitPrompt,
    /components: spaceGeneratedComponents\(parsed\.data\.components/,
  );
  assert.match(submitPrompt, /fixedComponentIds/);
  assert.match(submitPrompt, /if \(!isEdit \|\| layoutChanged\) fitComponentsInCanvas\(nextProject\.components\)/);
  assert.match(submitPrompt, /if \(isEdit\) \{[\s\S]*setSelectedIds\(addedIds\.length \? addedIds/);
  assert.match(submitPrompt, /setPendingPin\(null\)/);
});

test("sketch editor wraps long lines and provides vertical scrolling", async () => {
  const [studio, styles, route] = await Promise.all([
    readFile(studioUrl, "utf8"),
    readFile(globalStylesUrl, "utf8"),
    readFile(new URL("../app/api/ai/generate/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(studio, /ref={codeLineNumbersRef}/);
  assert.match(studio, /onScroll=\{\(event\) => \{ if \(codeLineNumbersRef\.current\)/);
  assert.match(styles, /\.code-editor pre \{[^}]*overflow-y: hidden/);
  assert.match(styles, /\.code-editor textarea \{[^}]*overflow-x: hidden; overflow-y: auto;[^}]*white-space: pre-wrap; overflow-wrap: anywhere/);
  assert.match(route, /Format every sketch as readable multiline C\+\+ with two-space indentation/);
});

test("imported projects fit their components into the visible canvas", async () => {
  const source = (await readFile(studioUrl, "utf8")).replace(/\r\n/g, "\n");
  const importProject = source.match(
    /const importProject = async[\s\S]*?\n  };\n\n  return \(/,
  )?.[0];

  assert.ok(importProject, "importProject implementation should be present");
  assert.match(importProject, /const imported = \{ \.\.\.parsed\.data, id: projectRef\.current\.id \}/);
  assert.match(importProject, /commitProject\(imported\)/);
  assert.match(importProject, /fitComponentsInCanvas\(imported\.components\)/);
});

test("Gemini generation defaults to supported Flash-Lite and is sent with prompts", async () => {
  const source = (await readFile(studioUrl, "utf8")).replace(/\r\n/g, "\n");

  assert.match(source, /const DEFAULT_GEMINI_MODEL[^=]*=\s*"gemini-3\.5-flash-lite"/);
  assert.match(source, /const GEMINI_MODELS = \["gemini-3\.5-flash-lite"\] as const/);
  assert.doesNotMatch(source, /"gemini-3\.5-flash"\s*:/);
  assert.match(source, /"gemini-3\.5-flash-lite"/);
  assert.match(source, /localStorage\.getItem\(MODEL_STORAGE_KEY\)/);
  assert.match(source, /localStorage\.setItem\(MODEL_STORAGE_KEY, nextModel\)/);
  assert.match(source, /assistantMode: requestMode/);
  assert.match(source, /generationModeOverride/);
  assert.match(source, /chatHistory: requestHistory/);
  assert.match(source, /useState<AssistantMode>\("build"\)/);
  assert.match(source, /className="assistant-mode-select"/);
  assert.match(source, /aria-label="Assistant mode"/);
  assert.match(source, /<option value="chat">Chat<\/option>/);
  assert.match(source, /<option value="build">Build<\/option>/);
  assert.match(source, /aria-label="AI model"/);
  assert.doesNotMatch(source, /generationTarget|Design only/);
  assert.match(source, /AI CIRCUIT BUILDER/);
  assert.match(source, /GENERAL AI CHAT/);
  assert.match(source, /Chat doesn’t use circuit requests\./);
  assert.match(source, /"gemini-3\.5-flash-lite": "Gemini 3\.5 Flash-Lite"/);
  assert.doesNotMatch(source, />\s*GEMINI CIRCUIT PLANNER/);
  assert.doesNotMatch(source, /sent to Gemini|Gemini generation failed/);
  assert.doesNotMatch(source, /AI-generated circuits only/);
});

test("assistant chat area can be resized independently from its fixed prompt composer", async () => {
  const [source, styles] = await Promise.all([
    readFile(studioUrl, "utf8"),
    readFile(globalStylesUrl, "utf8"),
  ]);

  assert.match(source, /assistantPrompt: number/);
  assert.match(source, /aria-label="Resize chat and prompt panels"/);
  assert.match(source, /className=\{`panel-resizer panel-resizer-assistant/);
  assert.match(source, /onPointerDown=\{\(event\) => beginPanelResize\("assistantPrompt", event\)\}/);
  assert.match(source, /panelSizes\.assistantPrompt \+ step/);
  assert.match(source, /"--assistant-prompt-height": `\$\{panelSizes\.assistantPrompt\}px`/);
  assert.match(styles, /grid-template-rows: 43px minmax\(0, 1fr\) 11px var\(--assistant-prompt-height, 320px\)/);
  assert.match(styles, /\.prompt-controls-scroll \{[^}]*overflow-y: auto/);
  assert.match(styles, /\.panel-resizer-assistant \{[^}]*cursor: row-resize/);
});

test("AI generation streams progress and keeps failed prompts available for retry", async () => {
  const source = (await readFile(studioUrl, "utf8")).replace(/\r\n/g, "\n");
  const submitPrompt = source.match(
    /const submitPrompt = async[\s\S]*?\n  };\n\n  const exportProject/,
  )?.[0];

  assert.ok(submitPrompt, "submitPrompt implementation should be present");
  assert.match(submitPrompt, /Accept: "application\/x-ndjson"/);
  assert.match(submitPrompt, /readGenerationResponse\(response, setGenerationStage\)/);
  assert.match(submitPrompt, /result\.kind === "mode-clarification"/);
  assert.match(submitPrompt, /modeChoice: \{ prompt: clean, model: responseModel \}/);
  assert.match(submitPrompt, /setFailedGeneration\(\{ prompt: clean, model: retryModel, assistantMode: requestMode/);
  assert.match(source, />Edit current circuit<\/button>/);
  assert.match(source, />Create new circuit<\/button>/);
  assert.match(source, /submitPrompt\(modeChoice\.prompt, true, modeChoice\.model, "build", \[\], "edit"\)/);
  assert.match(source, /submitPrompt\(modeChoice\.prompt, true, modeChoice\.model, "build", \[\], "create"\)/);
  assert.match(source, /submitPrompt\(failedGeneration\.prompt, true, failedGeneration\.model, failedGeneration\.assistantMode, failedGeneration\.chatHistory, failedGeneration\.generationModeOverride\)/);
  assert.match(source, /Your current circuit was not changed\./);
});

test("canvas marquee selects and deletes multiple components", async () => {
  const source = (await readFile(studioUrl, "utf8")).replace(/\r\n/g, "\n");

  assert.match(source, /type MarqueeState/);
  assert.match(source, /className="selection-marquee"/);
  assert.match(source, /setSelectedIds\(nextSelectedIds\)/);
  assert.match(source, /removeSelectedComponents/);
  assert.match(source, /removeComponentsFromProject\(current, existingIds\)/);
  assert.match(source, /Delete removes all/);
});

test("select all and bulk delete work even when a canvas button has focus", async () => {
  const source = (await readFile(studioUrl, "utf8")).replace(/\r\n/g, "\n");

  assert.match(source, /const selectAllComponents = useCallback/);
  assert.match(source, /projectRef\.current\.components\.map\(\(component\) => component\.id\)/);
  assert.match(source, /event\.key\.toLowerCase\(\) === "a"/);
  assert.match(source, /if \(!editing && \(event\.key === "Delete" \|\| event\.key === "Backspace"\)/);
  assert.doesNotMatch(source, /if \(!interactive && \(event\.key === "Delete" \|\| event\.key === "Backspace"\)/);
});

test("deterministic generation failures point to diagnostics instead of repeating the same retry", async () => {
  const source = (await readFile(studioUrl, "utf8")).replace(/\r\n/g, "\n");
  const messageHelper = source.match(/function conciseGenerationError\(error: GenerationRequestError\) \{[\s\S]*?\n\}/)?.[0];

  assert.ok(messageHelper, "generation failure guidance should be centralized");
  assert.match(messageHelper, /Open View diagnostics/);
  assert.match(messageHelper, /simplify the request/);
  assert.doesNotMatch(messageHelper, /Retry this prompt/);
  assert.match(source, /failedGeneration\?\.retryable && <button/);
});

test("pan mode still allows components to be dragged", async () => {
  const source = (await readFile(studioUrl, "utf8")).replace(/\r\n/g, "\n");
  const beginDrag = source.match(
    /const beginDrag = \(event: ReactPointerEvent, component: CircuitComponent\) => \{[\s\S]*?\n  \};/,
  )?.[0];

  assert.ok(beginDrag, "component drag handler should be present");
  assert.doesNotMatch(beginDrag, /canvasTool\s*===\s*"pan"/);
  assert.match(beginDrag, /setDragState/);
  assert.match(source, /Drag empty canvas to pan, or drag a component to move it/);
});

test("mobile users can open both workspace side panels", async () => {
  const [source, styles] = await Promise.all([
    readFile(studioUrl, "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(source, /type MobilePanel = "library" \| "assistant" \| null/);
  assert.match(source, /setMobilePanel\("library"\)/);
  assert.match(source, /setMobilePanel\("assistant"\)/);
  assert.match(source, /aria-controls="components-panel"/);
  assert.match(source, /aria-controls="ai-panel"/);
  assert.match(styles, /\.parts-panel\.mobile-open \{ display: flex/);
  assert.match(styles, /\.ai-panel\.mobile-open \{ display: grid/);
  assert.match(styles, /\.mobile-panel-backdrop/);
  assert.match(styles, /\.canvas-column \{ grid-template-rows: 72px minmax\(0, 1fr\); \}/);
  assert.doesNotMatch(styles, /\.zoom-controls button:first-child[\s\S]*?display: none/);
  assert.doesNotMatch(styles, /\.zoom-controls button:nth-child\(3\)[\s\S]*?display: none/);
});
