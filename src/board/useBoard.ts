import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import * as svc from "./boardService";

export type { Column, Task, TaskStatus } from "./boardService";

export function useBoard(authUserId?: string | null, currentProjectId?: string) {
  const [data, setData] = useState<{ columns: svc.Column[]; tasks: svc.Task[] }>({ columns: [], tasks: [] });
  const [boardLoading, setBoardLoading] = useState(false);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [isInitialBoardLoading, setIsInitialBoardLoading] = useState(false);

  const saveTimerRef = useRef<number | null>(null);
  const hasLoadedRef = useRef(false);

  function setBoard(next: { columns: svc.Column[]; tasks: svc.Task[] }) {
    setData(next);
  }

  function scheduleSaveBoard(nextCols: svc.Column[], nextTasks: svc.Task[]) {
    if (!authUserId || !currentProjectId) return;
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      svc.saveBoardToSupabase(nextCols, nextTasks, authUserId || undefined, currentProjectId)
        .then(() => {
          setBoardError(null);
        })
        .catch((e) => {
          console.error(e);
          if (isStatementTimeout(e)) {
            setBoardError("Saving is taking longer than expected. Please try again.");
            return;
          }
          setBoardError(e?.message || "Failed to save board");
        });
    }, 300);
  }

  useEffect(() => {
    let cancelled = false;

    setBoardError(null);
    if (!authUserId || !currentProjectId) {
      setData({ columns: [], tasks: [] });
      setBoardLoading(false);
      setIsInitialBoardLoading(false);
      hasLoadedRef.current = false;
      return;
    }

    const shouldShowInitialLoading = !hasLoadedRef.current;
    if (shouldShowInitialLoading) setIsInitialBoardLoading(true);

    async function loadBoard() {
      const userId = authUserId;
      const projectId = currentProjectId;
      if (!userId || !projectId) return;
      setBoardLoading(true);
      try {
        const loaded = await svc.loadBoardFromSupabase(projectId, userId);
        if (!loaded.columns.length) {
          const seeded = await svc.seedDefaultColumnsInSupabase(userId, projectId);
          if (!cancelled) setData({ columns: seeded || [], tasks: [] });
        } else {
          if (!cancelled) setData({ columns: loaded.columns, tasks: loaded.tasks });
        }
      } catch (e: any) {
        console.error(e);
        if (!cancelled) {
          if (isStatementTimeout(e)) {
            setBoardError("Loading is taking longer than expected. Please try again.");
          } else {
            setBoardError(e?.message || "Failed to load board");
          }
        }
      } finally {
        if (!cancelled) {
          setBoardLoading(false);
          if (shouldShowInitialLoading) setIsInitialBoardLoading(false);
          hasLoadedRef.current = true;
        }
      }
    }

    loadBoard();
    return () => { cancelled = true; };
  }, [authUserId, currentProjectId]);

  function normalizeTask(draft: svc.Task): svc.Task {
    const columnId = draft.columnId || draft.phaseId;
    const phaseId = draft.phaseId || draft.columnId;
    const normalizedAssignedIds = Array.isArray(draft.assignedUserIds) && draft.assignedUserIds.length
      ? Array.from(new Set(draft.assignedUserIds.filter(Boolean)))
      : draft.assignedUserId
        ? [draft.assignedUserId]
        : authUserId
          ? [authUserId]
          : [];
    const primaryAssignedId = normalizedAssignedIds[0] || draft.assignedUserId || authUserId || "";
    const percentComplete =
      typeof draft.percentComplete === "number" && Number.isFinite(draft.percentComplete)
        ? Math.max(0, Math.min(100, Math.round(draft.percentComplete)))
        : 0;
    const forcedStatus =
      percentComplete === 100
        ? "Completed"
        : percentComplete > 0 && percentComplete < 100
          ? "In Process"
          : undefined;
    return {
      ...draft,
      columnId,
      phaseId,
      assignedUserId: primaryAssignedId,
      assignedUserIds: normalizedAssignedIds.length ? normalizedAssignedIds : undefined,
      assignmentNotifications: draft.assignmentNotifications,
      status: forcedStatus ?? (draft?.status || "Unassigned"),
      percentComplete,
      statusOverride: draft.statusOverride,
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
    isInitialBoardLoading,
    setBoard,
    saveTask,
    deleteTask,
    removeColumn,
    scheduleSaveBoard,
  } as const;
}

function isStatementTimeout(error: any) {
  const message = typeof error?.message === "string" ? error.message : String(error || "");
  return message.toLowerCase().includes("statement timeout");
}
