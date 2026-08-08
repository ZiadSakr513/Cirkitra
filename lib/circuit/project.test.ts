import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultBlinkProject } from "./default-project.ts";
import { removeComponentFromProject, removeComponentsFromProject } from "./project.ts";

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
