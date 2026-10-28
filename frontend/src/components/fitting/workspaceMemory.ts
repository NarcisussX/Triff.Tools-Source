let workspaceSnapshot: unknown = null;

function cloneSnapshot<T>(value: T): T {
  if (value == null) return value;
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function readFittingWorkspaceSnapshot<T>(fallback: () => T): T {
  return workspaceSnapshot == null ? fallback() : cloneSnapshot(workspaceSnapshot as T);
}

export function writeFittingWorkspaceSnapshot<T>(workspace: T) {
  workspaceSnapshot = cloneSnapshot(workspace);
}
