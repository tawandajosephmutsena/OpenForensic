import Dexie, { type Table } from "dexie";
import type { Workspace } from "./types";
import { createWorkspaceId } from "./workspace-id";

interface WorkspaceRecord {
  id: string;
  data: Workspace;
}

export interface WorkspaceDocument {
  id: string;
  workspaceId: string;
  name: string;
  savedAt: string;
  size: number;
  mimeType: "application/pdf";
}

interface WorkspaceDocumentRecord extends WorkspaceDocument {
  data: Blob;
}

class OpenForensicDatabase extends Dexie {
  workspaces!: Table<WorkspaceRecord, string>;
  documents!: Table<WorkspaceDocumentRecord, string>;

  constructor() {
    // Keep the original IndexedDB name so existing local workspaces survive the rename.
    super("ledgerguard-local");
    this.version(1).stores({ workspaces: "id" });
    this.version(2).stores({ workspaces: "id", documents: "id, workspaceId, savedAt" });
  }
}

let database: OpenForensicDatabase | null = null;
function getDatabase() {
  if (typeof window === "undefined") throw new Error("Local workspace is available in the browser only.");
  database ??= new OpenForensicDatabase();
  return database;
}

export async function loadWorkspace(): Promise<Workspace | undefined> {
  const db = getDatabase();
  return db.transaction("rw", db.workspaces, async () => {
    const stored = await db.workspaces.get("current");
    if (!stored) return undefined;
    // Older workspaces predate document storage. Give each one an ID once.
    if (!stored.data.id) {
      stored.data.id = createWorkspaceId();
      await db.workspaces.put(stored);
    }
    return stored.data;
  });
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  const db = getDatabase();
  await db.transaction("rw", db.workspaces, db.documents, async () => {
    const previous = await db.workspaces.get("current");
    if (previous?.data.id && previous.data.id !== workspace.id) {
      await db.documents.where("workspaceId").equals(previous.data.id).delete();
    }
    await db.workspaces.put({ id: "current", data: workspace });
  });
}

export async function saveWorkspaceDocument(workspaceId: string, name: string, data: Blob): Promise<WorkspaceDocument> {
  if (!workspaceId) throw new Error("Choose a workspace before saving a document.");
  if (!name || data.type !== "application/pdf" || data.size === 0) throw new Error("Only nonempty PDF documents can be saved.");
  const document: WorkspaceDocumentRecord = {
    id: createWorkspaceId(),
    workspaceId,
    name,
    savedAt: new Date().toISOString(),
    size: data.size,
    mimeType: "application/pdf",
    data,
  };
  const db = getDatabase();
  await db.transaction("rw", db.workspaces, db.documents, async () => {
    const current = await db.workspaces.get("current");
    if (current?.data.id !== workspaceId) throw new Error("The active workspace changed. Reload this page before saving.");
    await db.documents.add(document);
  });
  const { data: _data, ...metadata } = document;
  return metadata;
}

export async function listWorkspaceDocuments(workspaceId: string): Promise<WorkspaceDocument[]> {
  if (!workspaceId) return [];
  const records = await getDatabase().documents.where("workspaceId").equals(workspaceId).sortBy("savedAt");
  return records.reverse().map(({ data: _data, ...metadata }) => metadata);
}

export async function countWorkspaceDocuments(workspaceId: string): Promise<number> {
  return workspaceId ? getDatabase().documents.where("workspaceId").equals(workspaceId).count() : 0;
}

export async function getWorkspaceDocument(workspaceId: string, documentId: string): Promise<Blob | undefined> {
  const record = await getDatabase().documents.get(documentId);
  return record?.workspaceId === workspaceId ? record.data : undefined;
}
