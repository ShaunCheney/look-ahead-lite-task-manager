import { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { arrayMove } from "@dnd-kit/sortable";
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

  const tasksByColumn = useMemo(() => {
    const map: Record<string, svc.Task[]> = Object.fromEntries(data.columns.map(c => [c.id, [] as svc.Task[]]));
    for (const t of data.tasks) { (map[t.columnId] ||= []).push(t); }
    return map;
  }, [data.columns, data.tasks]);

  function saveTask(draft: svc.Task) {
    const next = (() => {
      if (draft.id) {
        return { columns: data.columns, tasks: data.tasks.map((t) => (t.id === draft.id ? { ...draft } : t)) };
      }
      return { columns: data.columns, tasks: [...data.tasks, { ...draft, id: uuid() }] };
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

  function handleDragOver(event: any) {
    const { active, over } = event;
    if (!over) return;

    if (String(active?.id || "").startsWith("col:")) return;

    const activeTask = data.tasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    const overTask = data.tasks.find((t) => t.id === over.id);
    const overColumn = data.columns.find((c) => c.id === over.id);
    const destColumnId = overTask ? overTask.columnId : overColumn?.id;
    if (destColumnId && destColumnId !== activeTask.columnId) {
      const next = { columns: data.columns, tasks: data.tasks.map((t) => (t.id === activeTask.id ? { ...t, columnId: destColumnId } : t)) };
      setBoard(next);
      scheduleSaveBoard(next.columns, next.tasks);
    }
  }

  function handleDragEnd(event: any) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active?.id || "");
    const overId = String(over?.id || "");

    // column drag
    if (activeId.startsWith("col:") && overId.startsWith("col:")) {
      const fromColId = activeId.replace("col:", "");
      const toColId = overId.replace("col:", "");

      const oldIndex = data.columns.findIndex((c) => c.id === fromColId);
      const newIndex = data.columns.findIndex((c) => c.id === toColId);

      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        const nextCols = arrayMove(data.columns, oldIndex, newIndex);
        const next = { columns: nextCols, tasks: data.tasks };
        setBoard(next);
        scheduleSaveBoard(next.columns, next.tasks);
      }
      return;
    }

    // task drag
    const activeTask = data.tasks.find((t) => t.id === active.id);
    if (!activeTask) return;

    const overTask = data.tasks.find((t) => t.id === over.id);
    const sourceColumnId = activeTask.columnId;
    const destColumnId = overTask ? overTask.columnId : sourceColumnId;

    const sourceList = data.tasks.filter((t) => t.columnId === sourceColumnId);
    const destList = data.tasks.filter((t) => t.columnId === destColumnId);

    const sourceIndex = sourceList.findIndex((t) => t.id === active.id);
    const destIndex = overTask ? destList.findIndex((t) => t.id === over.id) : destList.length;
    if (sourceIndex === -1) return;

    let newDestIds: string[];
    if (sourceColumnId === destColumnId) {
      const ids = destList.map((t) => t.id);
      newDestIds = arrayMove(ids, sourceIndex, destIndex);
    } else {
      const destIds = destList.map((t) => t.id);
      newDestIds = [...destIds.slice(0, destIndex), active.id, ...destIds.slice(destIndex)];
    }

    const moved = data.tasks.map((t) => (t.id === active.id ? { ...t, columnId: destColumnId } : t));
    const withOrder = moved.map((t) =>
      t.columnId === destColumnId
        ? ({ ...(t as any), __ord: newDestIds.indexOf(t.id) } as any)
        : (t as any)
    );
    withOrder.sort((a: any, b: any) => (a.__ord ?? Number.MAX_SAFE_INTEGER) - (b.__ord ?? Number.MAX_SAFE_INTEGER));
    withOrder.forEach((t: any) => delete t.__ord);

    const next = { columns: data.columns, tasks: withOrder as svc.Task[] };
    setBoard(next);
    scheduleSaveBoard(next.columns, next.tasks);
  }

  return {
    columns: data.columns,
    tasks: data.tasks,
    tasksByColumn,
    boardLoading,
    boardError,
    setBoard,
    saveTask,
    deleteTask,
    removeColumn,
    handleDragOver,
    handleDragEnd,
    scheduleSaveBoard,
  } as const;
}
