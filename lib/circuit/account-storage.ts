export const LEGACY_LOCAL_PROJECT_KEY = "ai-circuit-studio.project.v1";

export function accountProjectCacheKey(userId: string, projectId: string) {
  return `ai-circuit-studio.account-project.v1:${userId}:${projectId}`;
}

export function legacyMigrationIdKey(userId: string) {
  return `ai-circuit-studio.legacy-migration-id.v1:${userId}`;
}
