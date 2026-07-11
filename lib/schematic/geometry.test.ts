import assert from "node:assert/strict";
import test from "node:test";

import {
  componentSize,
  fitViewport,
  orthogonalWireSegments,
  pinPosition,
  type Point,
  type SchematicDefinitionLike,
} from "./geometry.ts";

const everySideDefinition: SchematicDefinitionLike = {
  pins: [
    { id: "top-late", side: "top", order: 20 },
    { id: "right", side: "right", order: 0 },
    { id: "bottom", side: "bottom", order: 0 },
    { id: "left-low", side: "left", order: 5 },
    { id: "top-early", side: "top", order: 1 },
    { id: "left-high", side: "left", order: 0 },
  ],
};

function assertPointNear(actual: Point | undefined, expected: Point) {
  assert.ok(actual);
  assert.ok(Math.abs(actual.x - expected.x) < 1e-9);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-9);
}

test("uses physical symbol sizes and distributes every side by pin order", () => {
  assert.deepEqual(componentSize("arduino-uno"), {
    width: 320,
    height: 350,
  });

  const component = { type: "unknown-symbol", x: -100, y: -40 };
  assert.deepEqual(
    pinPosition(component, "top-early", everySideDefinition),
    { x: -60, y: -40 },
  );
  assert.deepEqual(
    pinPosition(component, "top-late", everySideDefinition),
    { x: -20, y: -40 },
  );
  assert.deepEqual(pinPosition(component, "right", everySideDefinition), {
    x: 20,
    y: 0,
  });
  assert.deepEqual(pinPosition(component, "bottom", everySideDefinition), {
    x: -40,
    y: 40,
  });
  assertPointNear(
    pinPosition(component, "left-high", everySideDefinition),
    { x: -100, y: -40 + 80 / 3 },
  );
  assertPointNear(
    pinPosition(component, "left-low", everySideDefinition),
    { x: -100, y: -40 + 160 / 3 },
  );
  assert.equal(
    pinPosition(component, "does-not-exist", everySideDefinition),
    undefined,
  );
});

test("rotates boundary pins clockwise around the component center", () => {
  const definition: SchematicDefinitionLike = {
    pins: [{ id: "input", side: "left", order: 0 }],
  };

  assert.deepEqual(
    pinPosition(
      { type: "resistor", x: 10, y: 20, rotation: 90 },
      "input",
      definition,
    ),
    { x: 80, y: -26 },
  );
});

test("routes exactly three axis-aligned wire segments", () => {
  const from = { x: -35, y: 10 };
  const to = { x: 85, y: 74 };
  const segments = orthogonalWireSegments(from, to);

  assert.deepEqual(segments, [
    { from: { x: -35, y: 10 }, to: { x: 25, y: 10 } },
    { from: { x: 25, y: 10 }, to: { x: 25, y: 74 } },
    { from: { x: 25, y: 74 }, to: { x: 85, y: 74 } },
  ]);
  assert.equal(segments.length, 3);
  for (const segment of segments) {
    assert.ok(
      segment.from.x === segment.to.x || segment.from.y === segment.to.y,
      "every routed segment must be horizontal or vertical",
    );
  }
});

function toScreen(point: Point, transform: ReturnType<typeof fitViewport>) {
  return {
    x: point.x * transform.zoom + transform.pan.x,
    y: point.y * transform.zoom + transform.pan.y,
  };
}

test("fits and centers components with negative world coordinates", () => {
  const components = [
    { type: "resistor", x: -300, y: -200 },
    { type: "led", x: 100, y: 50 },
  ];
  const transform = fitViewport(components, 1000, 600, 50);
  const topLeft = toScreen({ x: -300, y: -200 }, transform);
  const bottomRight = toScreen({ x: 172, y: 154 }, transform);

  assert.ok(transform.zoom > 0);
  assert.ok(topLeft.x >= 50 - Number.EPSILON);
  assert.ok(topLeft.y >= 50 - Number.EPSILON);
  assert.ok(bottomRight.x <= 950 + Number.EPSILON);
  assert.ok(bottomRight.y <= 550 + Number.EPSILON);
  assert.ok(Math.abs((topLeft.x + bottomRight.x) / 2 - 500) < 1e-9);
  assert.ok(Math.abs((topLeft.y + bottomRight.y) / 2 - 300) < 1e-9);
});

test("centers world origin when fitting an empty schematic", () => {
  assert.deepEqual(fitViewport([], 800, 500), {
    zoom: 1,
    pan: { x: 400, y: 250 },
  });
});
