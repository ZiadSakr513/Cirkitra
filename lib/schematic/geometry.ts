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

/**
 * A transform where `screenPoint = worldPoint * zoom + pan`.
 */
export interface ViewportTransform {
  zoom: number;
  pan: Point;
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
 * Compute a centered fit transform for any set of world-space components,
 * including layouts left of or above the world origin.
 */
export function fitViewport(
  components: readonly SchematicComponentLike[],
  viewportWidth: number,
  viewportHeight: number,
  padding = 48,
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
  if (validComponents.length === 0) {
    return {
      zoom: 1,
      pan: {
        x: safeViewportWidth / 2,
        y: safeViewportHeight / 2,
      },
    };
  }

  const bounds = validComponents
    .map(componentBounds)
    .reduce<Bounds>((combined, current) => ({
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
  const zoom = Math.min(usableWidth / boundsWidth, usableHeight / boundsHeight);
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
