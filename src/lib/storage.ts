import Dexie, { type Table } from "dexie";
import type { Workspace } from "./types";

interface WorkspaceRecord {
  id: string;
  data: Workspace;
}

class LedgerGuardDatabase extends Dexie {
  workspaces!: Table<WorkspaceRecord, string>;

  constructor() {
    super("ledgerguard-local");
    this.version(1).stores({ workspaces: "id" });
  }
}

let database: LedgerGuardDatabase | null = null;
function getDatabase() {
  if (typeof window === "undefined") throw new Error("Local workspace is available in the browser only.");
  database ??= new LedgerGuardDatabase();
  return database;
}

export async function loadWorkspace(): Promise<Workspace | undefined> {
  return (await getDatabase().workspaces.get("current"))?.data;
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  await getDatabase().workspaces.put({ id: "current", data: workspace });
}
