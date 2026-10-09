import { getComponentDefinition } from "../circuit/catalog.ts";
import type { CircuitComponent } from "../circuit/types.ts";
import { centerComponentsAtOrigin, componentSize } from "./geometry.ts";

export const GENERATED_COMPONENT_CLEARANCE = 32;

type LayoutBounds = { left: number; top: number; right: number; bottom: number };

export function generatedComponentFootprint(component: CircuitComponent): LayoutBounds {
  const size = componentSize(component.type);
  const turns = ((Math.round((component.rotation ?? 0) / 90) % 4) + 4) % 4;
  const width = turns % 2 === 0 ? size.width : size.height;
  const height = turns % 2 === 0 ? size.height : size.width;
  const centerX = component.x + size.width / 2;
  const centerY = component.y + size.height / 2;
  const body = {
    left: centerX - width / 2,
    top: centerY - height / 2,
    right: centerX + width / 2,
    bottom: centerY + height / 2,
  };

  // Schematic labels sit above the symbol. Reserve their measured text width
  // as part of the footprint so small parts cannot crowd a neighboring label.
  const label = component.label.trim();
  const labelWidth = Math.max(0, [...label].length * 7 + 12);
  const labelLeft = centerX - labelWidth / 2;
  const labelRight = centerX + labelWidth / 2;
  return {
    left: Math.min(body.left, labelLeft),
    top: Math.min(body.top, body.top - 24),
    right: Math.max(body.right, labelRight),
    bottom: body.bottom,
  };
}

function hasClearance(bounds: LayoutBounds, placed: readonly LayoutBounds[], clearance: number) {
  return placed.every((other) =>
    bounds.right + clearance <= other.left ||
    other.right + clearance <= bounds.left ||
    bounds.bottom + clearance <= other.top ||
    other.bottom + clearance <= bounds.top,
  );
}

function ringOffsets(radius: number) {
  if (radius === 0) return [{ x: 0, y: 0 }];
  const offsets: Array<{ x: number; y: number }> = [];
  for (let x = -radius; x <= radius; x += 1) {
    offsets.push({ x, y: -radius }, { x, y: radius });
  }
  for (let y = -radius + 1; y < radius; y += 1) {
    offsets.push({ x: -radius, y }, { x: radius, y });
  }
  return offsets.sort((a, b) => (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y) || a.y - b.y || a.x - b.x);
}

export type GeneratedLayoutOptions = {
  /** Existing parts whose positions must not change during an AI edit. */
  fixedComponentIds?: ReadonlySet<string>;
  /** Center the complete layout after spacing, for a full circuit generation. */
  center?: boolean;
  clearance?: number;
};

/**
 * Preserve valid AI placement, then move only colliding or too-close parts to
 * the nearest deterministic grid position. The search expands until it finds
 * open space, so a large generated circuit is allowed to grow rather than
 * compressing its component gaps.
 */
export function spaceGeneratedComponents(
  components: readonly CircuitComponent[],
  options: GeneratedLayoutOptions = {},
): CircuitComponent[] {
  const clearance = Number.isFinite(options.clearance)
    ? Math.max(0, options.clearance!)
    : GENERATED_COMPONENT_CLEARANCE;
  const step = Math.max(16, clearance);
  const fixedIds = options.fixedComponentIds ?? new Set<string>();
  const positions = components.map((component) => ({ ...component }));
  const placedBounds: LayoutBounds[] = [];
  const movable: Array<{ component: CircuitComponent; index: number; board: boolean; area: number }> = [];

  components.forEach((component, index) => {
    if (fixedIds.has(component.id)) {
      placedBounds.push(generatedComponentFootprint(component));
      return;
    }
    const size = componentSize(component.type);
    const definition = getComponentDefinition(component.type);
    movable.push({
      component,
      index,
      board: definition?.category === "boards",
      area: size.width * size.height,
    });
  });

  movable.sort((a, b) => Number(b.board) - Number(a.board) || b.area - a.area || a.index - b.index);
  for (const item of movable) {
    const target = item.component;
    for (let radius = 0; ; radius += 1) {
      for (const offset of ringOffsets(radius)) {
        const candidate = {
          ...target,
          x: target.x + offset.x * step,
          y: target.y + offset.y * step,
        };
        const bounds = generatedComponentFootprint(candidate);
        if (!hasClearance(bounds, placedBounds, clearance)) continue;
        positions[item.index] = candidate;
        placedBounds.push(bounds);
        radius = -Infinity;
        break;
      }
      if (radius === -Infinity) break;
    }
  }

  return options.center ? centerComponentsAtOrigin(positions) : positions;
}
