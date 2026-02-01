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
  | "Closed";

export interface Column {
  id: string;
  name: string;
  linkAfterId?: string;
}

export interface Task {
  id: string;
  title: string;
  notes?: string;
  columnId: string;
  status: TaskStatus;
  workDays?: number;
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
  const tks: Task[] = (taskRows || []).map((r: any) => ({
    id: r.id,
    title: r.title,
    notes: r.notes || undefined,
    status: (r.status as TaskStatus) || "Unassigned",
    workDays: typeof r.work_days === "number" ? r.work_days : undefined,
    columnId: r.column_id,
  }));

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
  const taskPayload = nextTasks.map((t) => ({
    id: t.id,
    user_id: authUserId,
    project_id: currentProjectId,
    column_id: t.columnId,
    title: t.title,
    notes: t.notes || null,
    status: t.status,
    work_days: typeof t.workDays === "number" ? t.workDays : null,
    sort_order: orderMap[t.id] ?? 0,
  }));

  const { error: taskUpsertErr } = await supabase
    .from("tasks")
    .upsert(taskPayload, { onConflict: "id" });

  if (taskUpsertErr) throw taskUpsertErr;
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
