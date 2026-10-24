import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultBlinkProject } from "./default-project.ts";
import { exportCircuitProject, importCircuitProject, importStoredCircuitProject } from "./import.ts";
import { ARDUINO_UNO_BOARD } from "./types.ts";

test("opens and upgrades a saved v0 project using its account-row identity and name", () => {
  const imported = importStoredCircuitProject({
    version: 0,
    id: "stale-payload-id",
    name: "Old embedded title",
    board: "arduino:avr:uno",
    components: [
      { id: "uno", type: "arduino-uno", name: "Arduino Uno", position: { x: 40, y: 60 } },
      { id: "led", type: "led", name: "Status LED", position: { x: 300, y: 60 } },
    ],
    wires: [{ from: { componentId: "uno", pin: "D13" }, to: { componentId: "led", pin: "A" } }],
    firmware: "void setup() {}\nvoid loop() {}",
  }, { id: "saved-row-id", name: "Renamed in projects" });

  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  assert.equal(imported.migratedFrom, 0);
  assert.equal(imported.project.schemaVersion, 1);
  assert.equal(imported.project.id, "saved-row-id");
  assert.equal(imported.project.name, "Renamed in projects");
  assert.equal(imported.project.board, ARDUINO_UNO_BOARD);
  assert.equal(imported.project.components[1]?.label, "Status LED");
  assert.deepEqual(imported.project.components[1] && [imported.project.components[1].x, imported.project.components[1].y], [300, 60]);
  assert.equal(imported.project.connections[0]?.id, "wire-1");
  assert.equal(imported.project.code, "void setup() {}\nvoid loop() {}");
});

test("loads current saved projects without marking them for migration", () => {
  const project = createDefaultBlinkProject();
  const imported = importStoredCircuitProject(project, { id: "row-id", name: "Account title" });

  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  assert.equal(imported.migratedFrom, null);
  assert.equal(imported.project.id, "row-id");
  assert.equal(imported.project.name, "Account title");
  assert.deepEqual(imported.project.components, project.components);
  assert.deepEqual(imported.project.connections, project.connections);
});

test("imports legacy scene-bearing projects as normal circuits and omits scene on export", () => {
  const project = createDefaultBlinkProject();
  const scene = { malformed: true, unrelated: { metadata: "discard" } };
  const imported = importStoredCircuitProject({ ...project, scene }, { id: "row-id", name: project.name });

  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  assert.equal("scene" in imported.project, false);
  assert.equal(imported.migratedFrom, null);
  assert.equal(imported.project.components.length, project.components.length);
  assert.equal("scene" in JSON.parse(exportCircuitProject(imported.project)), false);
});

test("migrates unversioned scene-bearing projects without retaining scene data", () => {
  const imported = importCircuitProject({
    version: 0,
    id: "legacy",
    name: "Legacy circuit",
    board: "arduino:avr:uno",
    components: [],
    connections: [],
    code: "",
    scene: { objects: ["discard"] },
  });
  assert.equal(imported.ok, true);
  if (!imported.ok) return;
  assert.equal(imported.migratedFrom, 0);
  assert.equal("scene" in imported.project, false);
});

test("does not downgrade a saved project from an unknown future schema", () => {
  const imported = importStoredCircuitProject({
    ...createDefaultBlinkProject(),
    schemaVersion: 2,
  }, { id: "row-id", name: "Future project" });

  assert.equal(imported.ok, false);
  if (imported.ok) return;
  assert.equal(imported.migratedFrom, null);
  assert.ok(imported.issues.some((issue) => issue.path === "$.schemaVersion"));
});
