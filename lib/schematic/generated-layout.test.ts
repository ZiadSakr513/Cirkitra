import assert from "node:assert/strict";
import test from "node:test";
import type { CircuitComponent } from "../circuit/types.ts";
import { GENERATED_COMPONENT_CLEARANCE, generatedComponentFootprint, spaceGeneratedComponents } from "./generated-layout.ts";

function part(id: string, type: string, x: number, y: number, label = id, rotation = 0): CircuitComponent {
  return { id, type, label, x, y, rotation, properties: {} } as CircuitComponent;
}

function assertClearance(components: readonly CircuitComponent[], clearance = GENERATED_COMPONENT_CLEARANCE) {
  const bounds = components.map(generatedComponentFootprint);
  for (let left = 0; left < bounds.length; left += 1) {
    for (let right = left + 1; right < bounds.length; right += 1) {
      const a = bounds[left];
      const b = bounds[right];
      assert.ok(
        a.right + clearance <= b.left || b.right + clearance <= a.left ||
        a.bottom + clearance <= b.top || b.bottom + clearance <= a.top,
        `${components[left].label} and ${components[right].label} must have ${clearance} units of clearance`,
      );
    }
  }
}

test("spaces crowded generated boards and labels with deterministic nearest placements", () => {
  const crowded = [
    part("uno", "arduino-uno", 0, 0, "Arduino Uno"),
    part("lcd", "lcd-16x2", 4, 4, "LCD 16x2"),
    part("servo", "servo", 8, 8, "Servo Gate", 90),
    part("resistor", "resistor", 12, 12, "R1"),
  ];

  const first = spaceGeneratedComponents(crowded);
  const second = spaceGeneratedComponents(crowded);

  assert.deepEqual(first, second);
  assertClearance(first);
  assert.deepEqual(first.map(({ id }) => id), crowded.map(({ id }) => id));
  assert.deepEqual(crowded.map(({ x, y }) => ({ x, y })), [
    { x: 0, y: 0 }, { x: 4, y: 4 }, { x: 8, y: 8 }, { x: 12, y: 12 },
  ], "layout must not mutate the source components");
});

test("includes long labels and rotated symbol bounds in spacing decisions", () => {
  const components = [
    part("led", "led", 0, 0, "Long indicator label beside a small LED"),
    part("button", "push-button", 55, 0, "Push button", 90),
  ];
  const spaced = spaceGeneratedComponents(components);

  assertClearance(spaced);
  assert.notDeepEqual(spaced.map(({ x, y }) => ({ x, y })), components.map(({ x, y }) => ({ x, y })));
});

test("keeps fixed edit components in place and spaces new and explicitly moved parts", () => {
  const existing = part("uno", "arduino-uno", 100, 100, "Arduino Uno");
  const existingMovedByEdit = part("lcd", "lcd-16x2", 110, 110, "LCD");
  const added = part("servo", "servo", 112, 112, "Servo");
  const result = spaceGeneratedComponents([existing, existingMovedByEdit, added], {
    fixedComponentIds: new Set([existing.id]),
  });

  assert.deepEqual({ x: result[0].x, y: result[0].y }, { x: existing.x, y: existing.y });
  assertClearance(result);
  assert.ok(result[1].x !== existingMovedByEdit.x || result[1].y !== existingMovedByEdit.y);
  assert.ok(result[2].x !== added.x || result[2].y !== added.y);
});

test("centers a full generated layout after spacing without changing non-layout project data", () => {
  const components = [part("uno", "arduino-uno", 800, 500), part("led", "led", 800, 500)];
  const project = {
    components,
    connections: [{ id: "wire-1", from: { componentId: "uno", pin: "D13" }, to: { componentId: "led", pin: "A" }, color: "red" }],
    code: "void setup() {} void loop() {}",
  };
  const result = { ...project, components: spaceGeneratedComponents(project.components, { center: true }) };
  const roundTrip = JSON.parse(JSON.stringify(result)) as typeof result;

  assertClearance(roundTrip.components);
  assert.deepEqual(roundTrip.connections, project.connections);
  assert.equal(roundTrip.code, project.code);
  assert.deepEqual(roundTrip.components.map(({ id, x, y }) => ({ id, x, y })), result.components.map(({ id, x, y }) => ({ id, x, y })));
});
