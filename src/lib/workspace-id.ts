export function createWorkspaceId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `workspace-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
