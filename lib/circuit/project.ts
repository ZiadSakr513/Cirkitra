import type { CircuitProject } from "./types.ts";

/**
 * Remove a placed component and every wire attached to it.
 *
 * Boards deliberately use the same operation as every other catalog part so
 * the editor can represent an empty canvas or let the user swap boards.
 */
export function removeComponentFromProject(
  project: CircuitProject,
  componentId: string,
): CircuitProject {
  return removeComponentsFromProject(project, [componentId]);
}

/** Remove several placed components and every wire attached to any of them. */
export function removeComponentsFromProject(
  project: CircuitProject,
  componentIds: readonly string[],
): CircuitProject {
  const removedIds = new Set(componentIds);
  if (!project.components.some((component) => removedIds.has(component.id))) {
    return project;
  }

  return {
    ...project,
    components: project.components.filter(
      (component) => !removedIds.has(component.id),
    ),
    connections: project.connections.filter(
      (connection) =>
        !removedIds.has(connection.from.componentId) &&
        !removedIds.has(connection.to.componentId),
    ),
  };
}
