import { isBoardType } from "./boards.ts";
import type { CircuitProject } from "./types.ts";

export function getActiveBoard(project: CircuitProject) {
  const selected = project.components.find(component => component.id === project.activeBoardId && isBoardType(component.type));
  return selected ?? project.components.find(component => component.type === project.board && isBoardType(component.type));
}

export function getBoardProgram(project: CircuitProject, boardComponentId: string): string {
  const saved = project.programs?.[boardComponentId];
  if (saved !== undefined) return saved;
  const active = getActiveBoard(project);
  return active?.id === boardComponentId ? project.code : "";
}

export function activateBoardProgram(project: CircuitProject, boardComponentId: string): CircuitProject {
  const board = project.components.find(component => component.id === boardComponentId && isBoardType(component.type));
  if (!board) throw new Error(`Board ${boardComponentId} is not present in the project.`);
  const current = getActiveBoard(project);
  const programs = { ...(project.programs ?? {}) };
  if (current) programs[current.id] = project.code;
  return { ...project, activeBoardId: board.id, board: board.type as CircuitProject["board"], code: programs[board.id] ?? "", programs };
}

export function updateActiveBoardProgram(project: CircuitProject, source: string): CircuitProject {
  const active = getActiveBoard(project);
  return { ...project, code: source, ...(active ? { activeBoardId: active.id, programs: { ...(project.programs ?? {}), [active.id]: source } } : {}) };
}
