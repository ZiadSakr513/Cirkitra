import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultBlinkProject } from "./default-project.ts";
import { normalizeGroundReturns, removeComponentFromProject, removeComponentsFromProject } from "./project.ts";

test("removes an Arduino Uno and all wires attached to it", () => {
  const project = createDefaultBlinkProject();
  const next = removeComponentFromProject(project, "uno");

  assert.equal(next.components.some((component) => component.id === "uno"), false);
  assert.equal(
    next.connections.some(
      (connection) =>
        connection.from.componentId === "uno" ||
        connection.to.componentId === "uno",
    ),
    false,
  );
  assert.equal(project.components.some((component) => component.id === "uno"), true);
  assert.equal(next.board, "arduino-uno");
});

test("returns the same project when the component does not exist", () => {
  const project = createDefaultBlinkProject();
  assert.equal(removeComponentFromProject(project, "missing"), project);
});

test("removes a marquee selection and every attached wire in one operation", () => {
  const project = createDefaultBlinkProject();
  const next = removeComponentsFromProject(project, ["led1", "r1"]);

  assert.deepEqual(next.components.map((component) => component.id), ["uno"]);
  assert.equal(next.connections.length, 0);
  assert.equal(project.components.length, 3);
});

test("spreads ground returns across Uno pins and uses one ground symbol per overflow", () => {
  const project = createDefaultBlinkProject();
  project.components = [
    project.components.find((component) => component.id === "uno")!,
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `load${index + 1}`,
      type: "led",
      label: `LED ${index + 1}`,
      x: 400 + index * 100,
      y: 100,
      rotation: 0 as const,
      properties: { color: "#ef4444" },
    })),
  ];
  project.connections = Array.from({ length: 5 }, (_, index) => ({
    id: `return-${index + 1}`,
    from: { componentId: `load${index + 1}`, pin: "K" },
    to: { componentId: "uno", pin: "GND" },
  }));

  const normalized = normalizeGroundReturns(project);
  assert.deepEqual(
    normalized.connections.slice(0, 3).map((connection) => connection.to.pin),
    ["GND", "GND2", "GND3"],
  );
  const overflow = normalized.connections.slice(3);
  assert.equal(new Set(overflow.map((connection) => connection.to.componentId)).size, 2);
  assert.ok(overflow.every((connection) => connection.to.pin === "GND"));
  assert.equal(normalized.components.filter((component) => component.type === "ground").length, 2);
  assert.deepEqual(normalizeGroundReturns(normalized), normalized, "normalization must be idempotent");
});

test("preserves a manually placed ground component", () => {
  const project = createDefaultBlinkProject();
  project.components.push({ id: "manual-ground", type: "ground", label: "GND", x: 500, y: 300 });
  project.connections[2] = {
    ...project.connections[2],
    to: { componentId: "manual-ground", pin: "GND" },
  };
  assert.equal(normalizeGroundReturns(project), project);
});
