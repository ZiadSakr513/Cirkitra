import assert from "node:assert/strict";
import test from "node:test";

import {
  centerComponentsAtOrigin,
  componentSize,
  fitViewport,
  orthogonalWireSegments,
  pinAwareWireSegments,
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

test("routes away from pins in the direction each pin faces", () => {
  const cases = [
    { side: "left" as const, point: { x: 0, y: 40 }, expected: { x: -18, y: 40 } },
    { side: "right" as const, point: { x: 120, y: 40 }, expected: { x: 138, y: 40 } },
    { side: "top" as const, point: { x: 60, y: 0 }, expected: { x: 60, y: -18 } },
    { side: "bottom" as const, point: { x: 60, y: 80 }, expected: { x: 60, y: 98 } },
  ];

  for (const routeCase of cases) {
    const [lead] = pinAwareWireSegments(
      { point: routeCase.point, side: routeCase.side },
      { point: { x: 300, y: 200 }, side: "left" },
      [{ type: "unknown-symbol", x: 0, y: 0 }],
    );
    assert.deepEqual(lead, { from: routeCase.point, to: routeCase.expected });
  }
});

test("pin-aware routing does not tunnel through component bodies", () => {
  const board = { type: "arduino-uno", x: 0, y: 0 };
  const obstacle = { type: "resistor", x: -150, y: 430 };
  const segments = pinAwareWireSegments(
    { point: { x: 0, y: 175 }, side: "left" },
    { point: { x: -80, y: 454 }, side: "top" },
    [board, obstacle],
  );

  assert.deepEqual(segments[0], {
    from: { x: 0, y: 175 },
    to: { x: -18, y: 175 },
  });
  for (const segment of segments) {
    assert.ok(segment.from.x === segment.to.x || segment.from.y === segment.to.y);
    const crossesBoardInterior = segment.from.y === segment.to.y
      ? segment.from.y > 0 && segment.from.y < 350 && Math.max(segment.from.x, segment.to.x) > 0 && Math.min(segment.from.x, segment.to.x) < 320
      : segment.from.x > 0 && segment.from.x < 320 && Math.max(segment.from.y, segment.to.y) > 0 && Math.min(segment.from.y, segment.to.y) < 350;
    assert.equal(crossesBoardInterior, false, "wire must not cross the Arduino body");
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

test("centers a distant layout on world origin without changing spacing", () => {
  const components = [
    { id: "uno", type: "arduino-uno", x: 900, y: 700 },
    { id: "resistor", type: "resistor", x: 1400, y: 800 },
  ];
  const centered = centerComponentsAtOrigin(components);

  assert.deepEqual(centered, [
    { id: "uno", type: "arduino-uno", x: -320, y: -175 },
    { id: "resistor", type: "resistor", x: 180, y: -75 },
  ]);
  assert.deepEqual(components[0], {
    id: "uno",
    type: "arduino-uno",
    x: 900,
    y: 700,
  });
});

test("centers rotated component bounds on world origin", () => {
  const [component] = centerComponentsAtOrigin([
    { id: "resistor", type: "resistor", x: 1000, y: 500, rotation: 90 },
  ]);

  assert.deepEqual(component, {
    id: "resistor",
    type: "resistor",
    x: -70,
    y: -24,
    rotation: 90,
  });
});

test("keeps pan centered when fitted zoom is capped", () => {
  const component = { type: "resistor", x: 100, y: 100 };
  const transform = fitViewport([component], 1000, 600, 50, {
    minZoom: 0.2,
    maxZoom: 1.5,
  });
  const center = toScreen({ x: 170, y: 124 }, transform);

  assert.equal(transform.zoom, 1.5);
  assert.ok(Math.abs(center.x - 500) < 1e-9);
  assert.ok(Math.abs(center.y - 300) < 1e-9);
});

test("keeps pan centered when fitted zoom is raised to its minimum", () => {
  const components = [
    { type: "resistor", x: -5000, y: -100 },
    { type: "led", x: 5000, y: 100 },
  ];
  const transform = fitViewport(components, 1000, 600, 50, {
    minZoom: 0.2,
    maxZoom: 1.5,
  });
  const center = toScreen({ x: 36, y: 52 }, transform);

  assert.equal(transform.zoom, 0.2);
  assert.ok(Math.abs(center.x - 500) < 1e-9);
  assert.ok(Math.abs(center.y - 300) < 1e-9);
});
