import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import * as svc from "./boardService";

export type { Column, Task, TaskStatus } from "./boardService";

export function useBoard(authUserId?: string | null, currentProjectId?: string) {
  const [data, setData] = useState<{ columns: svc.Column[]; tasks: svc.Task[] }>({ columns: [], tasks: [] });
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);

  const saveTimerRef = useRef<number | null>(null);

  function setBoard(next: { columns: svc.Column[]; tasks: svc.Task[] }) {
    setData(next);
  }

  function scheduleSaveBoard(nextCols: svc.Column[], nextTasks: svc.Task[]) {
    if (!authUserId || !currentProjectId) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      svc.saveBoardToSupabase(nextCols, nextTasks, authUserId || undefined, currentProjectId).catch((e) => {
        console.error(e);
        setBoardError(e?.message || "Failed to save board");
      });
    }, 300);
  }

  useEffect(() => {
    let cancelled = false;
    async function loadBoard() {
      setBoardError(null);
      if (!authUserId || !currentProjectId) {
        setData({ columns: [], tasks: [] });
        return;
      }

      setBoardLoading(true);
      try {
        const loaded = await svc.loadBoardFromSupabase(currentProjectId, authUserId);
        if (!loaded.columns.length) {
          const seeded = await svc.seedDefaultColumnsInSupabase(authUserId, currentProjectId);
          if (!cancelled) setData({ columns: seeded || [], tasks: [] });
        } else {
          if (!cancelled) setData({ columns: loaded.columns, tasks: loaded.tasks });
        }
      } catch (e: any) {
        console.error(e);
        if (!cancelled) setBoardError(e?.message || "Failed to load board");
      } finally {
        if (!cancelled) setBoardLoading(false);
      }
    }

    loadBoard();
    return () => { cancelled = true; };
  }, [authUserId, currentProjectId]);

  function normalizeTask(draft: svc.Task): svc.Task {
    const columnId = draft.columnId || draft.phaseId;
    const phaseId = draft.phaseId || draft.columnId;
    return {
      ...draft,
      columnId,
      phaseId,
      assignedUserId: draft.assignedUserId || authUserId || "",
      status: draft.status || "Unassigned",
    };
  }

  function saveTask(draft: svc.Task) {
    const normalized = normalizeTask(draft);
    const next = (() => {
      if (normalized.id) {
        return { columns: data.columns, tasks: data.tasks.map((t) => (t.id === normalized.id ? { ...normalized } : t)) };
      }
      return { columns: data.columns, tasks: [...data.tasks, { ...normalized, id: uuid() }] };
    })();

    setBoard(next);
    scheduleSaveBoard(next.columns, next.tasks);
  }

  async function deleteTask(id: string) {
    const next = { columns: data.columns, tasks: data.tasks.filter(t => t.id !== id) };
    setBoard(next);
    try {
      await svc.deleteTaskById(id);
      scheduleSaveBoard(next.columns, next.tasks);
    } catch (e: any) {
      console.error(e);
      setBoardError(e?.message || null);
    }
  }

  async function removeColumn(id: string) {
    // optimistic
    const next = { columns: data.columns.filter(c => c.id !== id), tasks: data.tasks.filter(t => t.columnId !== id) };
    setBoard(next);
    try {
      await svc.deleteTasksByColumnId(id);
      await svc.deleteColumnById(id);
      scheduleSaveBoard(next.columns, next.tasks);
    } catch (e: any) {
      console.error(e);
      setBoardError(e?.message || null);
    }
  }

  return {
    columns: data.columns,
    tasks: data.tasks,
    boardLoading,
    boardError,
    setBoard,
    saveTask,
    deleteTask,
    removeColumn,
    scheduleSaveBoard,
  } as const;
}
