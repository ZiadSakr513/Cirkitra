/** A point in schematic world or viewport coordinates. */
export interface Point {
  x: number;
  y: number;
}

/** The unrotated visual footprint of a schematic component. */
export interface ComponentSize {
  width: number;
  height: number;
}

/**
 * The small subset of a placed circuit component needed by the geometry
 * layer. Coordinates describe the top-left of the unrotated symbol.
 */
export interface SchematicComponentLike {
  type: string;
  x: number;
  y: number;
  rotation?: number;
}

export type SchematicPinSide = "top" | "right" | "bottom" | "left";

/** The catalog fields required to lay out one pin. */
export interface SchematicPinDefinitionLike {
  id: string;
  side: SchematicPinSide;
  order: number;
}

/** The catalog fields required to lay out all pins on a component. */
export interface SchematicDefinitionLike {
  pins: readonly SchematicPinDefinitionLike[];
}

/** One axis-aligned section of a routed schematic wire. */
export interface WireSegment {
  from: Point;
  to: Point;
}

export interface WireRouteEndpoint {
  point: Point;
  side: SchematicPinSide;
}

export interface CoordinatedWireInput {
  id: string;
  from: WireRouteEndpoint;
  to: WireRouteEndpoint;
}

export interface WireBridge {
  point: Point;
  segmentIndex: number;
  orientation: "horizontal" | "vertical";
}

export interface CoordinatedWireRoute {
  id: string;
  segments: WireSegment[];
  bridges: WireBridge[];
}

/**
 * A transform where `screenPoint = worldPoint * zoom + pan`.
 */
export interface ViewportTransform {
  zoom: number;
  pan: Point;
}

export interface ViewportZoomLimits {
  minZoom?: number;
  maxZoom?: number;
}

const DEFAULT_COMPONENT_SIZE: Readonly<ComponentSize> = {
  width: 120,
  height: 80,
};

/**
 * Physical-symbol footprints used by the Proteus-like schematic renderer.
 * These are deliberately roomier than the previous card UI so dense pin
 * groups (especially the Uno headers and DIP packages) remain selectable.
 */
const COMPONENT_SIZES: Readonly<Record<string, Readonly<ComponentSize>>> = {
  ground: { width: 56, height: 58 },
  "arduino-uno": { width: 320, height: 350 },
  led: { width: 72, height: 104 },
  "rgb-led": { width: 88, height: 112 },
  resistor: { width: 140, height: 48 },
  "push-button": { width: 96, height: 72 },
  "toggle-switch": { width: 112, height: 80 },
  potentiometer: { width: 104, height: 112 },
  "seven-segment": { width: 116, height: 164 },
  "lcd-16x2": { width: 240, height: 132 },
  buzzer: { width: 92, height: 92 },
  servo: { width: 140, height: 112 },
  "dc-motor": { width: 96, height: 96 },
  l293d: { width: 160, height: 232 },
  "logic-and": { width: 112, height: 80 },
  "logic-or": { width: 112, height: 80 },
  "logic-xor": { width: 112, height: 80 },
  "logic-nand": { width: 120, height: 80 },
  "logic-nor": { width: 120, height: 80 },
  "logic-not": { width: 104, height: 72 },
  "hc-sr04": { width: 176, height: 96 },
  "temperature-sensor": { width: 112, height: 104 },
  "pir-sensor": { width: 112, height: 112 },
};

/** Return the canonical visual footprint for a catalog component type. */
export function componentSize(type: string): ComponentSize {
  const size = COMPONENT_SIZES[type] ?? DEFAULT_COMPONENT_SIZE;
  return { width: size.width, height: size.height };
}

function normalizedRotation(rotation: number | undefined): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(rotation)) return 0;

  const quarterTurns = Math.round((rotation ?? 0) / 90);
  const normalizedQuarterTurns = ((quarterTurns % 4) + 4) % 4;
  return (normalizedQuarterTurns * 90) as 0 | 90 | 180 | 270;
}

function rotateAround(point: Point, center: Point, rotation: number): Point {
  const dx = point.x - center.x;
  const dy = point.y - center.y;

  switch (rotation) {
    case 90:
      return { x: center.x - dy, y: center.y + dx };
    case 180:
      return { x: center.x - dx, y: center.y - dy };
    case 270:
      return { x: center.x + dy, y: center.y - dx };
    default:
      return point;
  }
}

/**
 * Resolve one catalog pin to a point on the actual component boundary.
 *
 * Pins on each side are sorted by `order` and then distributed evenly. The
 * returned point is rotation-aware and can be fed directly into wire routing.
 * An unknown pin returns `undefined` rather than placing a misleading wire at
 * the component center.
 */
export function pinPosition(
  component: SchematicComponentLike,
  pinId: string,
  definition: SchematicDefinitionLike,
): Point | undefined {
  const pin = definition.pins.find((candidate) => candidate.id === pinId);
  if (!pin) return undefined;

  const sidePins = definition.pins
    .map((candidate, sourceIndex) => ({ candidate, sourceIndex }))
    .filter(({ candidate }) => candidate.side === pin.side)
    .sort(
      (a, b) =>
        a.candidate.order - b.candidate.order || a.sourceIndex - b.sourceIndex,
    );
  const pinIndex = sidePins.findIndex(
    ({ candidate }) => candidate.id === pinId,
  );
  if (pinIndex < 0) return undefined;

  const size = componentSize(component.type);
  const fraction = (pinIndex + 1) / (sidePins.length + 1);
  let point: Point;

  switch (pin.side) {
    case "top":
      point = {
        x: component.x + size.width * fraction,
        y: component.y,
      };
      break;
    case "right":
      point = {
        x: component.x + size.width,
        y: component.y + size.height * fraction,
      };
      break;
    case "bottom":
      point = {
        x: component.x + size.width * fraction,
        y: component.y + size.height,
      };
      break;
    case "left":
      point = {
        x: component.x,
        y: component.y + size.height * fraction,
      };
      break;
  }

  const rotation = normalizedRotation(component.rotation);
  if (rotation === 0) return point;

  return rotateAround(
    point,
    {
      x: component.x + size.width / 2,
      y: component.y + size.height / 2,
    },
    rotation,
  );
}

/**
 * Route a deterministic three-section orthogonal wire. Zero-length end
 * sections are retained so callers can render or edit a stable tuple shape.
 */
export function orthogonalWireSegments(
  from: Point,
  to: Point,
): readonly [WireSegment, WireSegment, WireSegment] {
  const middleX = from.x + (to.x - from.x) / 2;
  const firstCorner = { x: middleX, y: from.y };
  const secondCorner = { x: middleX, y: to.y };

  return [
    { from: { ...from }, to: firstCorner },
    { from: firstCorner, to: secondCorner },
    { from: secondCorner, to: { ...to } },
  ];
}

function escapePoint(endpoint: WireRouteEndpoint, clearance: number): Point {
  switch (endpoint.side) {
    case "top": return { x: endpoint.point.x, y: endpoint.point.y - clearance };
    case "right": return { x: endpoint.point.x + clearance, y: endpoint.point.y };
    case "bottom": return { x: endpoint.point.x, y: endpoint.point.y + clearance };
    case "left": return { x: endpoint.point.x - clearance, y: endpoint.point.y };
  }
}

function segmentLength(segment: WireSegment) {
  return Math.abs(segment.to.x - segment.from.x) + Math.abs(segment.to.y - segment.from.y);
}

function segmentCrossesBounds(segment: WireSegment, bounds: Bounds) {
  if (segment.from.y === segment.to.y) {
    const y = segment.from.y;
    const left = Math.min(segment.from.x, segment.to.x);
    const right = Math.max(segment.from.x, segment.to.x);
    return y > bounds.top && y < bounds.bottom && right > bounds.left && left < bounds.right;
  }
  const x = segment.from.x;
  const top = Math.min(segment.from.y, segment.to.y);
  const bottom = Math.max(segment.from.y, segment.to.y);
  return x > bounds.left && x < bounds.right && bottom > bounds.top && top < bounds.bottom;
}

function segmentsFromPoints(points: readonly Point[]): WireSegment[] {
  const compact = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  return compact.slice(1).map((point, index) => ({ from: compact[index], to: point }));
}

function rangesOverlap(a1: number, a2: number, b1: number, b2: number) {
  return Math.max(Math.min(a1, a2), Math.min(b1, b2)) < Math.min(Math.max(a1, a2), Math.max(b1, b2));
}

function collinearOverlap(a: WireSegment, b: WireSegment) {
  const aHorizontal = a.from.y === a.to.y;
  const bHorizontal = b.from.y === b.to.y;
  if (aHorizontal !== bHorizontal) return false;
  return aHorizontal
    ? a.from.y === b.from.y && rangesOverlap(a.from.x, a.to.x, b.from.x, b.to.x)
    : a.from.x === b.from.x && rangesOverlap(a.from.y, a.to.y, b.from.y, b.to.y);
}

function perpendicularIntersection(a: WireSegment, b: WireSegment): Point | undefined {
  const aHorizontal = a.from.y === a.to.y;
  const bHorizontal = b.from.y === b.to.y;
  if (aHorizontal === bHorizontal) return undefined;
  const horizontal = aHorizontal ? a : b;
  const vertical = aHorizontal ? b : a;
  const point = { x: vertical.from.x, y: horizontal.from.y };
  const insideHorizontal = point.x > Math.min(horizontal.from.x, horizontal.to.x) && point.x < Math.max(horizontal.from.x, horizontal.to.x);
  const insideVertical = point.y > Math.min(vertical.from.y, vertical.to.y) && point.y < Math.max(vertical.from.y, vertical.to.y);
  return insideHorizontal && insideVertical ? point : undefined;
}

function candidateMiddleRoutes(
  start: Point,
  end: Point,
  obstacles: readonly Bounds[],
  clearance: number,
) {
  const minLeft = Math.min(start.x, end.x, ...obstacles.map((bounds) => bounds.left)) - clearance;
  const maxRight = Math.max(start.x, end.x, ...obstacles.map((bounds) => bounds.right)) + clearance;
  const minTop = Math.min(start.y, end.y, ...obstacles.map((bounds) => bounds.top)) - clearance;
  const maxBottom = Math.max(start.y, end.y, ...obstacles.map((bounds) => bounds.bottom)) + clearance;
  const xBases = [start.x, end.x, (start.x + end.x) / 2, minLeft, maxRight, ...obstacles.flatMap((bounds) => [bounds.left, bounds.right])];
  const yBases = [start.y, end.y, (start.y + end.y) / 2, minTop, maxBottom, ...obstacles.flatMap((bounds) => [bounds.top, bounds.bottom])];
  const laneOffsets = [0, -12, 12, -24, 24, -36, 36, -48, 48];
  const xChannels = [...new Set(xBases.flatMap((value) => laneOffsets.map((offset) => value + offset)))];
  const yChannels = [...new Set(yBases.flatMap((value) => laneOffsets.map((offset) => value + offset)))];
  const candidates: Point[][] = [
    [start, { x: end.x, y: start.y }, end],
    [start, { x: start.x, y: end.y }, end],
  ];
  for (const x of xChannels) candidates.push([start, { x, y: start.y }, { x, y: end.y }, end]);
  for (const y of yChannels) candidates.push([start, { x: start.x, y }, { x: end.x, y }, end]);
  return candidates
    .map(segmentsFromPoints)
    .filter((segments) => segments.every((segment) => obstacles.every((bounds) => !segmentCrossesBounds(segment, bounds))));
}

function routeScore(candidate: readonly WireSegment[], occupied: readonly WireSegment[]) {
  const length = candidate.reduce((sum, segment) => sum + segmentLength(segment), 0);
  let overlaps = 0;
  let crossings = 0;
  for (const segment of candidate) {
    for (const other of occupied) {
      if (collinearOverlap(segment, other)) overlaps += 1;
      else if (perpendicularIntersection(segment, other)) crossings += 1;
    }
  }
  return overlaps * 1_000_000 + crossings * 4_000 + candidate.length * 32 + length;
}

/** Route all wires together so later wires avoid lanes already in use. */
export function coordinatedWireRoutes(
  wires: readonly CoordinatedWireInput[],
  components: readonly SchematicComponentLike[],
  clearance = 18,
): CoordinatedWireRoute[] {
  const safeClearance = Number.isFinite(clearance) ? Math.max(8, clearance) : 18;
  const obstacles = components.map((component) => {
    const bounds = componentBounds(component);
    return { left: bounds.left - safeClearance, top: bounds.top - safeClearance, right: bounds.right + safeClearance, bottom: bounds.bottom + safeClearance };
  });
  const routes: CoordinatedWireRoute[] = [];
  const occupied: WireSegment[] = [];

  for (const wire of wires) {
    const start = escapePoint(wire.from, safeClearance);
    const end = escapePoint(wire.to, safeClearance);
    const startLead = { from: { ...wire.from.point }, to: start };
    const endLead = { from: end, to: { ...wire.to.point } };
    const candidates = candidateMiddleRoutes(start, end, obstacles, safeClearance)
      .sort((a, b) => routeScore(a, occupied) - routeScore(b, occupied));
    const middle = candidates[0] ?? segmentsFromPoints([start, { x: start.x, y: end.y }, end]);
    const segments = [startLead, ...middle, endLead].filter((segment) => segmentLength(segment) > 0);
    routes.push({ id: wire.id, segments, bridges: [] });
    occupied.push(...segments);
  }

  for (let routeIndex = 0; routeIndex < routes.length; routeIndex += 1) {
    const route = routes[routeIndex];
    for (let earlierIndex = 0; earlierIndex < routeIndex; earlierIndex += 1) {
      for (let segmentIndex = 0; segmentIndex < route.segments.length; segmentIndex += 1) {
        const segment = route.segments[segmentIndex];
        for (const earlierSegment of routes[earlierIndex].segments) {
          const point = perpendicularIntersection(segment, earlierSegment);
          if (!point) continue;
          route.bridges.push({
            point,
            segmentIndex,
            orientation: segment.from.y === segment.to.y ? "horizontal" : "vertical",
          });
        }
      }
    }
  }
  return routes;
}

/**
 * Route a wire away from each pin in the direction that pin faces, then choose
 * the shortest orthogonal channel that does not cross a component body.
 */
export function pinAwareWireSegments(
  from: WireRouteEndpoint,
  to: WireRouteEndpoint,
  components: readonly SchematicComponentLike[],
  clearance = 18,
): WireSegment[] {
  const safeClearance = Number.isFinite(clearance) ? Math.max(8, clearance) : 18;
  const start = escapePoint(from, safeClearance);
  const end = escapePoint(to, safeClearance);
  const obstacles = components.map((component) => {
    const bounds = componentBounds(component);
    return {
      left: bounds.left - safeClearance,
      top: bounds.top - safeClearance,
      right: bounds.right + safeClearance,
      bottom: bounds.bottom + safeClearance,
    };
  });
  const minLeft = Math.min(start.x, end.x, ...obstacles.map((bounds) => bounds.left)) - safeClearance;
  const minTop = Math.min(start.y, end.y, ...obstacles.map((bounds) => bounds.top)) - safeClearance;
  const validRoutes = candidateMiddleRoutes(start, end, obstacles, safeClearance)
    .sort((a, b) => {
      const lengthDifference = a.reduce((sum, segment) => sum + segmentLength(segment), 0) -
        b.reduce((sum, segment) => sum + segmentLength(segment), 0);
      return lengthDifference || a.length - b.length;
    });
  const middle = validRoutes[0] ?? segmentsFromPoints([start, { x: minLeft, y: start.y }, { x: minLeft, y: minTop }, { x: end.x, y: minTop }, end]);

  return [
    { from: { ...from.point }, to: start },
    ...middle,
    { from: end, to: { ...to.point } },
  ].filter((segment) => segmentLength(segment) > 0);
}

interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function componentBounds(component: SchematicComponentLike): Bounds {
  const size = componentSize(component.type);
  const rotation = normalizedRotation(component.rotation);
  if (rotation === 0 || rotation === 180) {
    return {
      left: component.x,
      top: component.y,
      right: component.x + size.width,
      bottom: component.y + size.height,
    };
  }

  const centerX = component.x + size.width / 2;
  const centerY = component.y + size.height / 2;
  return {
    left: centerX - size.height / 2,
    top: centerY - size.width / 2,
    right: centerX + size.height / 2,
    bottom: centerY + size.width / 2,
  };
}

/**
 * Center a complete layout on world origin while preserving every component's
 * relative position. Generated projects use this before the viewport is fit so
 * the 0,0 crosshair remains the stable center of each new circuit.
 */
export function centerComponentsAtOrigin<T extends SchematicComponentLike>(
  components: readonly T[],
): T[] {
  const validComponents = components.filter(
    (component) => Number.isFinite(component.x) && Number.isFinite(component.y),
  );
  if (validComponents.length === 0) return [...components];

  const bounds = validComponents
    .map(componentBounds)
    .reduce((combined, current) => ({
      left: Math.min(combined.left, current.left),
      top: Math.min(combined.top, current.top),
      right: Math.max(combined.right, current.right),
      bottom: Math.max(combined.bottom, current.bottom),
    }));
  const offsetX = -(bounds.left + bounds.right) / 2;
  const offsetY = -(bounds.top + bounds.bottom) / 2;

  return components.map((component) => ({
    ...component,
    x: component.x + offsetX,
    y: component.y + offsetY,
  }));
}

/**
 * Compute a centered fit transform for any set of world-space components,
 * including layouts left of or above the world origin.
 */
export function fitViewport(
  components: readonly SchematicComponentLike[],
  viewportWidth: number,
  viewportHeight: number,
  padding = 48,
  zoomLimits: ViewportZoomLimits = {},
): ViewportTransform {
  const safeViewportWidth = Number.isFinite(viewportWidth)
    ? Math.max(0, viewportWidth)
    : 0;
  const safeViewportHeight = Number.isFinite(viewportHeight)
    ? Math.max(0, viewportHeight)
    : 0;

  const validComponents = components.filter(
    (component) => Number.isFinite(component.x) && Number.isFinite(component.y),
  );
  const requestedMinZoom = Number.isFinite(zoomLimits.minZoom)
    ? Math.max(0.01, zoomLimits.minZoom ?? 0.01)
    : 0.01;
  const requestedMaxZoom = Number.isFinite(zoomLimits.maxZoom)
    ? Math.max(0.01, zoomLimits.maxZoom ?? Number.POSITIVE_INFINITY)
    : Number.POSITIVE_INFINITY;
  const minZoom = Math.min(requestedMinZoom, requestedMaxZoom);
  const maxZoom = Math.max(requestedMinZoom, requestedMaxZoom);

  if (validComponents.length === 0) {
    return {
      zoom: Math.min(maxZoom, Math.max(minZoom, 1)),
      pan: {
        x: safeViewportWidth / 2,
        y: safeViewportHeight / 2,
      },
    };
  }

  const bounds = validComponents
    .map(componentBounds)
    .reduce((combined, current) => ({
      left: Math.min(combined.left, current.left),
      top: Math.min(combined.top, current.top),
      right: Math.max(combined.right, current.right),
      bottom: Math.max(combined.bottom, current.bottom),
    }));

  const safePadding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const usableWidth = Math.max(1, safeViewportWidth - safePadding * 2);
  const usableHeight = Math.max(1, safeViewportHeight - safePadding * 2);
  const boundsWidth = Math.max(1, bounds.right - bounds.left);
  const boundsHeight = Math.max(1, bounds.bottom - bounds.top);
  const naturalZoom = Math.min(usableWidth / boundsWidth, usableHeight / boundsHeight);
  const zoom = Math.min(maxZoom, Math.max(minZoom, naturalZoom));
  const worldCenterX = (bounds.left + bounds.right) / 2;
  const worldCenterY = (bounds.top + bounds.bottom) / 2;

  return {
    zoom,
    pan: {
      x: safeViewportWidth / 2 - worldCenterX * zoom,
      y: safeViewportHeight / 2 - worldCenterY * zoom,
    },
  };
}
