import { supabase } from "../supabaseClient";
import { v4 as uuid } from "uuid";

export type TaskStatus =
  | "Unassigned"
  | "Completed"
  | "In Process"
  | "Delayed/Overdue"
  | "This week"
  | "Next week"
  | "Week After"
  | "Future Work"
  | "Closed";

const TASK_UPSERT_BATCH_SIZE = 25;

export interface PhotoAttachment {
  id: string;
  uri: string;
}

export interface Column {
  id: string;
  name: string;
  linkAfterId?: string;
}

export interface Task {
  id: string;
  title: string;
  phaseId: string;
  assignedUserId: string;
  assignedUserIds?: string[];
  assignmentNotifications?: Record<string, boolean>;
  startDate?: string;
  endDate?: string;
  photos?: PhotoAttachment[];
  notes?: string;
  columnId: string;
  status: TaskStatus;
  workDays?: number;
  percentComplete?: number;
  statusOverride?: TaskStatus;
}

type TaskMeta = {
  phaseId?: string;
  assignedUserId?: string;
  assignedUserIds?: string[];
  assignmentNotifications?: Record<string, boolean>;
  startDate?: string;
  endDate?: string;
  photos?: PhotoAttachment[];
  photo?: PhotoAttachment;
  percentComplete?: number;
  statusOverride?: TaskStatus;
};

const PHOTO_META_START = "<photo-task-meta>";
const PHOTO_META_END = "</photo-task-meta>";

function parseTaskMeta(notes?: string | null): { meta?: TaskMeta; text?: string } {
  if (!notes) return {};
  const startIdx = notes.indexOf(PHOTO_META_START);
  if (startIdx === -1) return { text: notes };
  const endIdx = notes.indexOf(PHOTO_META_END, startIdx + PHOTO_META_START.length);
  if (endIdx === -1) return { text: notes };

  const raw = notes.slice(startIdx + PHOTO_META_START.length, endIdx);
  let meta: TaskMeta | undefined;
  try {
    meta = JSON.parse(raw);
  } catch {
    meta = undefined;
  }
  const text = notes.slice(0, startIdx).trimEnd();
  return { meta, text: text || undefined };
}

function mapTaskRowToTask(row: any, authUserId?: string): Task {
  const parsed = parseTaskMeta(row.notes || undefined);
  const meta = parsed.meta;
  const columnId = row.column_id as string;
  const phaseId = meta?.phaseId || columnId;
  const fallbackAssigned = meta?.assignedUserId || authUserId || "";
  const assignedUserIds = Array.isArray(meta?.assignedUserIds)
    ? meta?.assignedUserIds.filter(Boolean)
    : fallbackAssigned
      ? [fallbackAssigned]
      : [];
  const percentComplete =
    typeof meta?.percentComplete === "number" && Number.isFinite(meta.percentComplete)
      ? meta.percentComplete
      : 0;
  const metaPhotos = Array.isArray(meta?.photos)
    ? meta?.photos
    : meta?.photo
      ? [meta.photo]
      : undefined;
  return {
    id: row.id,
    title: row.title,
    notes: row.notes || undefined,
    status: (row.status as TaskStatus) || "Unassigned",
    workDays: typeof row.work_days === "number" ? row.work_days : undefined,
    columnId,
    phaseId,
    assignedUserId: assignedUserIds[0] || fallbackAssigned,
    assignedUserIds: assignedUserIds.length ? assignedUserIds : undefined,
    assignmentNotifications: meta?.assignmentNotifications,
    startDate: meta?.startDate,
    endDate: meta?.endDate,
    photos: metaPhotos && metaPhotos.length ? metaPhotos : undefined,
    percentComplete,
    statusOverride: meta?.statusOverride,
  };
}

export function buildTaskNotes(existingNotes: string | undefined, meta: TaskMeta): string | null {
  const parsed = parseTaskMeta(existingNotes);
  const text = parsed.text ?? (existingNotes ? existingNotes.trimEnd() : undefined);
  const payload = JSON.stringify(meta);
  const prefix = text ? `${text}\n\n` : "";
  return `${prefix}${PHOTO_META_START}${payload}${PHOTO_META_END}`;
}

export async function loadBoardFromSupabase(projectId: string, authUserId?: string) {
  if (!authUserId) return { columns: [] as Column[], tasks: [] as Task[] };

  const { data: colRows, error: colErr } = await supabase
    .from("project_columns")
    .select("id,name,sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });

  if (colErr) throw colErr;

  const { data: taskRows, error: taskErr } = await supabase
    .from("tasks")
    .select("id,title,notes,status,work_days,sort_order,column_id")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });

  if (taskErr) throw taskErr;

  const cols: Column[] = (colRows || []).map((r: any) => ({ id: r.id, name: r.name }));
  const tks: Task[] = (taskRows || []).map((r: any) => mapTaskRowToTask(r, authUserId));

  return { columns: cols, tasks: tks };
}

export function computeTaskSortOrders(cols: Column[], tks: Task[]) {
  const perCol: Record<string, Task[]> = {};
  for (const c of cols) perCol[c.id] = [];
  for (const t of tks) (perCol[t.columnId] ||= []).push(t);

  const taskOrder: Record<string, number> = {};
  for (const colId of Object.keys(perCol)) {
    const list = perCol[colId];
    for (let i = 0; i < list.length; i++) {
      taskOrder[list[i].id] = i;
    }
  }
  return taskOrder;
}

export async function saveBoardToSupabase(nextCols: Column[], nextTasks: Task[], authUserId?: string, currentProjectId?: string) {
  if (!authUserId || !currentProjectId) return;

  const colPayload = nextCols.map((c, idx) => ({
    id: c.id,
    user_id: authUserId,
    project_id: currentProjectId,
    name: c.name,
    sort_order: idx,
  }));

  const { error: colUpsertErr } = await supabase
    .from("project_columns")
    .upsert(colPayload, { onConflict: "id" });

  if (colUpsertErr) throw colUpsertErr;

  const orderMap = computeTaskSortOrders(nextCols, nextTasks);
  const taskPayload = nextTasks.map((t) => {
    const meta: TaskMeta = {
      phaseId: t.phaseId || t.columnId,
      assignedUserId: t.assignedUserId,
      assignedUserIds: t.assignedUserIds && t.assignedUserIds.length ? t.assignedUserIds : undefined,
      assignmentNotifications: t.assignmentNotifications,
      startDate: t.startDate,
      endDate: t.endDate,
      photos: t.photos && t.photos.length ? t.photos : undefined,
      percentComplete: typeof t.percentComplete === "number" ? t.percentComplete : undefined,
      statusOverride: t.statusOverride,
    };
    return {
      id: t.id,
      user_id: authUserId, // Fix: set user_id for RLS/NOT NULL constraints
      project_id: currentProjectId, // Fix: always include project_id
      column_id: t.columnId,
      title: t.title,
      notes: buildTaskNotes(t.notes, meta),
      status: t.status,
      work_days: typeof t.workDays === "number" ? t.workDays : null,
      sort_order: orderMap[t.id] ?? 0,
    };
  });

  await upsertTasksWithRetry(taskPayload);
}

export async function saveTaskToSupabase(task: Task, projectId: string, sortOrder: number, authUserId: string) {
  // Fix: save single task with user_id for RLS/NOT NULL constraints.
  const meta: TaskMeta = {
    phaseId: task.phaseId || task.columnId,
    assignedUserId: task.assignedUserId,
    assignedUserIds: task.assignedUserIds && task.assignedUserIds.length ? task.assignedUserIds : undefined,
    assignmentNotifications: task.assignmentNotifications,
    startDate: task.startDate,
    endDate: task.endDate,
    photos: task.photos && task.photos.length ? task.photos : undefined,
    percentComplete: typeof task.percentComplete === "number" ? task.percentComplete : undefined,
    statusOverride: task.statusOverride,
  };

  const payload = {
    id: task.id,
    user_id: authUserId,
    project_id: projectId,
    column_id: task.columnId,
    title: task.title,
    notes: buildTaskNotes(task.notes, meta),
    status: task.status,
    work_days: typeof task.workDays === "number" ? task.workDays : null,
    sort_order: sortOrder,
  };

  const { data, error } = await supabase
    .from("tasks")
    .upsert([payload], { onConflict: "id" })
    .select("id,title,notes,status,work_days,sort_order,column_id");

  if (error) throw error;
  const row = data?.[0];
  if (!row) {
    throw new Error("Task save did not return a row.");
  }
  return row;
}

export { mapTaskRowToTask };

function isStatementTimeout(error: any) {
  const message = typeof error?.message === "string" ? error.message : String(error || "");
  return message.toLowerCase().includes("statement timeout");
}

async function upsertTasksInBatches(payload: any[], batchSize: number) {
  for (let i = 0; i < payload.length; i += batchSize) {
    const batch = payload.slice(i, i + batchSize);
    const { error } = await supabase
      .from("tasks")
      .upsert(batch, { onConflict: "id" });
    if (error) throw error;
  }
}

async function upsertTasksWithRetry(payload: any[]) {
  if (!payload.length) return;
  try {
    await upsertTasksInBatches(payload, TASK_UPSERT_BATCH_SIZE);
  } catch (error) {
    if (isStatementTimeout(error) && payload.length > 1) {
      await upsertTasksInBatches(payload, Math.max(5, Math.floor(TASK_UPSERT_BATCH_SIZE / 2)));
      return;
    }
    throw error;
  }
}

export async function seedDefaultColumnsInSupabase(userId: string, projectId: string) {
  if (!userId) return [] as Column[];

  const names = ["Sign Sub Contractors", "Factory Work", "Site Work"];
  const payload = names.map((name, idx) => ({
    id: uuid(),
    user_id: userId,
    project_id: projectId,
    name,
    sort_order: idx,
  }));

  const { error } = await supabase.from("project_columns").insert(payload);
  if (error) throw error;

  return payload.map((r) => ({ id: r.id, name: r.name }));
}

export async function deleteTasksByColumnId(columnId: string) {
  const { error } = await supabase.from("tasks").delete().eq("column_id", columnId);
  if (error) throw error;
}

export async function deleteTaskById(id: string) {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteColumnById(id: string) {
  const { error } = await supabase.from("project_columns").delete().eq("id", id);
  if (error) throw error;
}
