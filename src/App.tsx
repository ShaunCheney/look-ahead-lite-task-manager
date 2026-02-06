import { supabase } from "./supabaseClient";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import { DndContext, closestCenter, MouseSensor, TouchSensor, useDroppable, useSensor, useSensors } from "@dnd-kit/core";

import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { KeyboardSensor } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import { useBoard } from "./hooks/useBoard";
import { buildTaskNotes, computeTaskSortOrders, seedDefaultColumnsInSupabase as seedCols, type PhotoAttachment, type Task, type TaskStatus } from "./board/boardService";
import { CameraTaskButton, PhotoTaskModal, TaskPhotoViewer, type UserOption } from "./components/photo-task";

import {
  GripVertical,
  Plus,
  Pencil,
  Camera,
  Columns,
  Download,
  Upload,
  FileText,
  Trash2,
  ChevronRight,
  ChevronDown,
  LogOut,
  Menu
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";

// recharts for the Task Summary chart
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from "recharts";

// ================= Types =================
interface Column {
  id: string;
  name: string;
  linkAfterId?: string;
}

interface ProjectRow {
  id: string;
  name: string;
  user_id?: string;
  created_at?: string;
}

const STATUS_OPTIONS: TaskStatus[] = [
  "Unassigned",
  "Completed",
  "In Process",
  "Delayed/Overdue",
  "This week",
  "Next week",
  "Week After",
  "Closed",
];

// ================= Status styling =================
function getStatusClasses(status: TaskStatus) {
  switch (status) {
    case "Completed":
      return { card: "bg-emerald-50 border-emerald-100", chip: "bg-emerald-100 text-emerald-800 border-emerald-200" };
    case "In Process":
      return { card: "bg-sky-50 border-sky-100", chip: "bg-sky-100 text-sky-800 border-sky-200" };
    case "Delayed/Overdue":
      return { card: "bg-rose-50 border-rose-100", chip: "bg-rose-100 text-rose-800 border-rose-200" };
    case "This week":
      return { card: "bg-amber-50 border-amber-100", chip: "bg-amber-100 text-amber-900 border-amber-200" };
    case "Next week":
      return { card: "bg-indigo-50 border-indigo-100", chip: "bg-indigo-100 text-indigo-800 border-indigo-200" };
    case "Week After":
      return { card: "bg-fuchsia-50 border-fuchsia-100", chip: "bg-fuchsia-100 text-fuchsia-800 border-fuchsia-200" };
    case "Closed":
      return { card: "bg-neutral-50 border-neutral-200", chip: "bg-neutral-200 text-neutral-700 border-neutral-300" };
    case "Unassigned":
    default:
      return { card: "bg-slate-50 border-slate-200", chip: "bg-slate-200 text-slate-700 border-slate-300" };
  }
}

// pastel fills for the chart
const STATUS_COLORS: Record<TaskStatus, string> = {
  "Completed": "#A7F3D0",
  "In Process": "#BAE6FD",
  "Delayed/Overdue": "#FECACA",
  "This week": "#FDE68A",
  "Next week": "#C7D2FE",
  "Week After": "#F5D0FE",
  "Closed": "#E5E7EB",
  "Unassigned": "#E2E8F0",
};

// ========= Helpers for default columns =========

// ===== CSV helpers (Excel-friendly) =====
function escapeCsv(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  const str = String(value);
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function parseCsv(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "");
  if (!lines.length) return [];
  const rows: string[][] = [];
  for (const line of lines) {
    const row: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === "\"") {
          if (line[i + 1] === "\"") {
            current += "\"";
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          current += ch;
        }
      } else {
        if (ch === "\"") {
          inQuotes = true;
        } else if (ch === ",") {
          row.push(current);
          current = "";
        } else {
          current += ch;
        }
      }
    }
    row.push(current);
    rows.push(row);
  }
  return rows;
}

function normalizeStatus(value: string): TaskStatus {
  const trimmed = value.trim().toLowerCase();
  const match = STATUS_OPTIONS.find(s => s.toLowerCase() === trimmed);
  return (match || "Unassigned") as TaskStatus;
}

// ================= Small hooks =================
function useIsMobile(breakpointPx = 768) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < breakpointPx;
  });

  useEffect(() => {
    const onResize = () => setIsMobile(window.innerWidth < breakpointPx);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [breakpointPx]);

  return isMobile;
}

// ================= Reusable UI =================
function SortableTask({
  task,
  onEdit,
  onDelete,
  onRename,
  onViewPhoto,
}: {
  task: Task;
  onEdit: (t: Task) => void;
  onDelete: (id: string) => void;
  onRename: (t: Task) => void;
  onViewPhoto?: (photo: PhotoAttachment, task: Task) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: task.id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition };
  const tone = getStatusClasses(task.status);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const photo = task.photo;
  const canViewPhoto = !!photo && !!onViewPhoto;

  useEffect(() => {
    if (!isEditingTitle) setTitleDraft(task.title);
  }, [task.title, isEditingTitle]);

  function commitTitle() {
    const nextTitle = titleDraft.trim();
    if (!nextTitle) {
      setTitleDraft(task.title);
      setIsEditingTitle(false);
      return;
    }
    if (nextTitle !== task.title) {
      onRename({ ...task, title: nextTitle });
    }
    setIsEditingTitle(false);
  }

  return (
    <div ref={setNodeRef} style={style} className="mb-2">
      <Card className={`rounded-lg shadow-sm border text-sm ${tone.card}`}>
        <CardContent className="p-2">
          <div className="flex justify-between items-start gap-2 mb-1">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-dashed border-neutral-300 text-[10px] uppercase tracking-wide text-neutral-500 cursor-grab active:cursor-grabbing select-none bg-white/60 flex-shrink-0"
                {...attributes}
                {...listeners}
              >
                <GripVertical className="h-2.5 w-2.5" />
              </div>
              <div className="flex flex-wrap items-center gap-1 min-w-0">
                <Badge className={`rounded-full text-[9px] px-1.5 py-0.5 border pointer-events-none ${tone.chip}`}>
                  {task.status}
                </Badge>
                {typeof task.workDays === "number" && (
                  <Badge className={`rounded-full text-[9px] px-1.5 py-0.5 border pointer-events-none ${tone.chip}`}>
                    {task.workDays}d
                  </Badge>
                )}
              </div>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              {canViewPhoto && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-1.5 text-xs"
                  onClick={() => {
                    if (!photo || !onViewPhoto) return;
                    onViewPhoto(photo, task);
                  }}
                  title="View photo"
                >
                  <Camera className="h-3 w-3" />
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => onEdit(task)}>
                <Pencil className="h-3 w-3" />
              </Button>
              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-xs" onClick={() => onDelete(task.id)}>
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <div className="min-w-0 w-full">
            {isEditingTitle ? (
              <Input
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={commitTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitTitle();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setTitleDraft(task.title);
                    setIsEditingTitle(false);
                  }
                }}
                className="h-7 px-2 text-sm font-semibold w-full"
                autoFocus
              />
            ) : (
              <button
                type="button"
                className="text-left text-sm font-semibold leading-tight break-words whitespace-normal hover:underline w-full"
                onClick={() => setIsEditingTitle(true)}
                title="Click to rename"
              >
                {task.title}
              </button>
            )}
          </div>

        </CardContent>
      </Card>
    </div>
  );
}

function QuickAddTask({
  columnId,
  onCreate,
}: {
  columnId: string;
  onCreate: (columnId: string, title: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const ignoreBlurRef = useRef(false);

  function commit({ keepFocus }: { keepFocus: boolean }) {
    const title = draft.trim();
    if (!title) {
      if (!keepFocus) setDraft("");
      return;
    }
    onCreate(columnId, title);
    setDraft("");
  }

  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit({ keepFocus: true });
          return;
        }
        if (e.key === "Tab") {
          e.preventDefault();
          commit({ keepFocus: true });
        }
      }}
      onBlur={() => {
        if (ignoreBlurRef.current) {
          ignoreBlurRef.current = false;
          return;
        }
        if (draft.trim()) commit({ keepFocus: false });
      }}
      placeholder="+ Add task"
      className="w-full min-h-[56px] rounded-lg border border-dashed border-neutral-300 bg-neutral-50/60 text-left px-3 py-2 text-xs text-neutral-700 hover:bg-neutral-100 focus-visible:ring-0 focus-visible:ring-offset-0"
    />
  );
}

/**
 * Makes the whole phase sortable, and lets us attach the drag handle
 * specifically to the "Move Phase" pill.
 */
function SortableColumn({
  column,
  children,
}: {
  column: Column;
  children: (args: {
    setActivatorNodeRef: (element: HTMLElement | null) => void;
    attributes: any;
    listeners: any;
  }) => React.ReactNode;
}) {
  const dndId = `col:${column.id}`;

  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
  } = useSortable({ id: dndId });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ setActivatorNodeRef, attributes, listeners })}
    </div>
  );
}

function ColumnDropZone({
  columnId,
  children,
}: {
  columnId: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: columnId });

  return (
    <div
      ref={setNodeRef}
      className={`rounded-xl transition-colors ${isOver ? "ring-2 ring-neutral-300" : ""}`}
    >
      {children}
    </div>
  );
}


function TaskEditor({
  openTask,
  onSave,
  onClose,
}: {
  openTask: Task | null;
  onSave: (t: Task) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Task | null>(openTask);
  useEffect(() => setDraft(openTask), [openTask]);
  if (!draft) return null;

  return (
    <Sheet open={!!openTask} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg bg-white">
        <SheetHeader>
          <SheetTitle>{draft.id ? "Edit Task" : "New Task"}</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-medium">Title</label>
            <Input
              autoFocus
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              placeholder="e.g., Call vendor / Order material"
            />
          </div>

          <div>
            <label className="text-xs font-medium">Status</label>
            <Select
              value={draft.status}
              onValueChange={(v) => setDraft({ ...draft, status: v as TaskStatus })}
            >
              <SelectTrigger className="w-full bg-white">
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent className="bg-white">
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium">Work days</label>
            <Input
              type="number"
              min={0}
              step={1}
              value={typeof draft.workDays === "number" ? String(draft.workDays) : ""}
              onChange={(e) => {
                const v = e.target.value;
                const n = v === "" ? undefined : Math.max(0, Math.floor(Number(v)));
                setDraft({ ...draft, workDays: n });
              }}
              placeholder="e.g., 3"
            />
          </div>
          <div className="pt-2 flex gap-2">
            <Button
              className="rounded-2xl"
              disabled={!draft.title.trim()}
              onClick={() => {
                onSave(draft);
                onClose();
              }}
            >
              Save
            </Button>
            <Button variant="secondary" className="rounded-2xl" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ColumnEditor({
  initial,
  onSave,
  onClose,
}: {
  initial: Column | null;
  onSave: (c: Column) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState<string>(initial?.name || "");
  useEffect(() => setName(initial?.name || ""), [initial]);

  function handleSave() {
    const id = initial?.id || uuid();
    onSave({ id, name: name.trim() || "Untitled", linkAfterId: initial?.linkAfterId });
    onClose();
  }

  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-md bg-white">
        <SheetHeader>
          <SheetTitle>{initial?.id ? "Rename Phase" : "New Phase"}</SheetTitle>
        </SheetHeader>
        <div className="mt-6 space-y-4">
          <div>
            <label className="text-xs font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleSave();
                }
              }}
              placeholder="e.g., Site Work"
            />
          </div>
          <div className="pt-2 flex gap-2">
            <Button onClick={handleSave}>
              Save
            </Button>
            <Button variant="secondary" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ======= Text export helpers for reports =======
function buildThreeWeekText(tasks: Task[], columns: Column[]): string {
  const sections: { title: string; key: TaskStatus }[] = [
    { title: "Completed", key: "Completed" },
    { title: "In Process", key: "In Process" },
    { title: "This Week", key: "This week" },
    { title: "Next Week", key: "Next week" },
    { title: "Week After", key: "Week After" },
  ];
  const colName = (id: string) => columns.find(c => c.id === id)?.name || "Unknown";

  const lines: string[] = [];
  lines.push("3 Week Look Ahead");
  lines.push("");

  for (const section of sections) {
    const items = tasks.filter((t) => t.status === section.key);
    lines.push(section.title);
    if (!items.length) {
      lines.push("  (No items)");
    } else {
      for (const t of items) {
        let line = `- ${t.title}`;
        const meta: string[] = [];
        const cn = colName(t.columnId);
        if (cn) meta.push(cn);
        if (typeof t.workDays === "number") meta.push(`${t.workDays}d`);
        if (meta.length) line += ` (${meta.join(", ")})`;
        lines.push("  " + line);
      }
    }
    lines.push("");
  }
  return lines.join("\n");
}

function buildOwnerUpdateText(tasks: Task[], columns: Column[]): string {
  const UPCOMING: TaskStatus[] = ["This week", "Next week", "Week After"];
  const colName = (id: string) => columns.find(c => c.id === id)?.name || "Unknown";
  const completed = tasks.filter(t => t.status === "Completed");
  const inProcess = tasks.filter(t => t.status === "In Process");
  const upcoming = tasks.filter(t => UPCOMING.includes(t.status));

  const lines: string[] = [];
  lines.push("Owner Update");
  lines.push("");

  function section(label: string, items: Task[]) {
    lines.push(label);
    if (!items.length) {
      lines.push("  (No items)");
    } else {
      for (const t of items) {
        let line = `- ${t.title}`;
        const meta: string[] = [];
        const cn = colName(t.columnId);
        if (cn) meta.push(cn);
        if (typeof t.workDays === "number") meta.push(`${t.workDays}d`);
        if (meta.length) line += ` (${meta.join(", ")})`;
        lines.push("  " + line);
      }
    }
    lines.push("");
  }

  section("Completed", completed);
  section("In Process", inProcess);
  section("Upcoming", upcoming);

  return lines.join("\n");
}

function buildTaskSummaryText(tasks: Task[], columns: Column[]): string {
  const byCol: Record<string, Record<TaskStatus, number>> = {};
  for (const c of columns) {
    byCol[c.id] = STATUS_OPTIONS.reduce((acc, s) => {
      acc[s] = 0;
      return acc;
    }, {} as Record<TaskStatus, number>);
  }
  for (const t of tasks) {
    const days = typeof t.workDays === "number" ? t.workDays : 0;
    if (!byCol[t.columnId]) {
      byCol[t.columnId] = STATUS_OPTIONS.reduce((acc, s) => {
        acc[s] = 0;
        return acc;
      }, {} as Record<TaskStatus, number>);
    }
    byCol[t.columnId][t.status] += days;
  }

  const lines: string[] = [];
  lines.push("Task Summary (work days)");
  lines.push("");

  for (const col of columns) {
    const stats = byCol[col.id];
    lines.push(col.name);
    const any = Object.values(stats).some(v => v > 0);
    if (!any) {
      lines.push("  (No work days logged)");
    } else {
      for (const status of STATUS_OPTIONS) {
        const v = stats[status];
        if (v > 0) lines.push(`  - ${status}: ${v}d`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

function copyTextToClipboard(text: string) {
  if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).catch(() => {
      window.prompt("Copy the text below:", text);
    });
  } else {
    window.prompt("Copy the text below:", text);
  }
}

function openPrintWindowWithText(title: string, text: string) {
  const win = window.open("", "_blank");
  if (!win) return;
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  win.document.write(`
    <html>
      <head>
        <title>${title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <style>
          body {
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            padding: 24px;
            white-space: pre-wrap;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <pre>${escaped}</pre>
      </body>
    </html>
  `);
  win.document.close();
  win.focus();
  win.print();
}

// ============ Reports ===============
function ThreeWeekReport({ tasks, columns, onClose }: { tasks: Task[]; columns: Column[]; onClose: () => void; }) {
  const textExport = useMemo(() => buildThreeWeekText(tasks, columns), [tasks, columns]);

  const sections: { title: string; key: TaskStatus }[] = [
    { title: "Completed", key: "Completed" },
    { title: "In Process", key: "In Process" },
    { title: "This Week", key: "This week" },
    { title: "Next Week", key: "Next week" },
    { title: "Week After", key: "Week After" },
  ];
  const colName = (id: string) => columns.find(c => c.id === id)?.name || "Unknown";

  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto print:max-w-full print:w-full print:border-none bg-white">
        <div className="space-y-6">
          <div className="flex items-center gap-3 pr-16 print:pr-0">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <FileText className="h-5 w-5" /> 3 Week Look Ahead
            </h2>
            <div className="flex gap-2 print:hidden">
              <Button variant="secondary" onClick={() => window.print()}>Print</Button>
              <Button onClick={() => openPrintWindowWithText("3 Week Look Ahead", textExport)}>Save as PDF</Button>
              <Button variant="outline" onClick={() => copyTextToClipboard(textExport)}>Copy as text</Button>
            </div>
          </div>
          {sections.map((section) => {
            const items = tasks.filter((t) => t.status === section.key);
            return (
              <div key={section.key} className="mb-6">
                <h3 className="text-lg font-semibold mb-2">{section.title}</h3>
                {items.length === 0 ? (
                  <p className="text-sm opacity-60">No items</p>
                ) : (
                  <ul className="list-disc list-inside space-y-1">
                    {items.map((t) => (
                      <li key={t.id} className="text-sm">
                        <span className="font-medium">{t.title}</span>
                        <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-neutral-100 border">
                          {colName(t.columnId)}
                        </span>
                        {typeof t.workDays === 'number' && (
                          <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-neutral-100 border">
                            {t.workDays}d
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OwnerUpdateReport({ tasks, columns, onClose }: { tasks: Task[]; columns: Column[]; onClose: () => void; }) {
  const textExport = useMemo(() => buildOwnerUpdateText(tasks, columns), [tasks, columns]);

  const UPCOMING: TaskStatus[] = ["This week", "Next week", "Week After"];
  const colName = (id: string) => columns.find(c => c.id === id)?.name || "Unknown";
  const completed = tasks.filter(t => t.status === "Completed");
  const inProcess = tasks.filter(t => t.status === "In Process");
  const upcoming = tasks.filter(t => UPCOMING.includes(t.status));

  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto print:max-w-full print:w-full print:border-none bg-white">
        <div className="space-y-6">
          <div className="flex items-center gap-3 pr-16 print:pr-0">
            <h2 className="text-xl font-bold flex items-center gap-2">
              <FileText className="h-5 w-5" /> Owner Update
            </h2>
            <div className="flex gap-2 print:hidden">
              <Button variant="secondary" onClick={() => window.print()}>Print</Button>
              <Button onClick={() => openPrintWindowWithText("Owner Update", textExport)}>Save as PDF</Button>
              <Button variant="outline" onClick={() => copyTextToClipboard(textExport)}>Copy as text</Button>
            </div>
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">Completed</h3>
            {completed.length === 0 ? (
              <p className="text-sm opacity-60">No items</p>
            ) : (
              <ul className="list-disc list-inside space-y-1">
                {completed.map((t) => (
                  <li key={t.id} className="text-sm">
                    <span className="font-medium">{t.title}</span>
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-neutral-100 border">
                      {colName(t.columnId)}
                    </span>
                    {typeof t.workDays === 'number' && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-neutral-100 border">
                        {t.workDays}d
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">In Process</h3>
            {inProcess.length === 0 ? (
              <p className="text-sm opacity-60">No items</p>
            ) : (
              <ul className="list-disc list-inside space-y-1">
                {inProcess.map((t) => (
                  <li key={t.id} className="text-sm">
                    <span className="font-medium">{t.title}</span>
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-neutral-100 border">
                      {colName(t.columnId)}
                    </span>
                    {typeof t.workDays === 'number' && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-neutral-100 border">
                        {t.workDays}d
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mb-6">
            <h3 className="text-lg font-semibold mb-2">Upcoming</h3>
            {upcoming.length === 0 ? (
              <p className="text-sm opacity-60">No items</p>
            ) : (
              <ul className="list-disc list-inside space-y-1">
                {upcoming.map((t) => (
                  <li key={t.id} className="text-sm">
                    <span className="font-medium">{t.title}</span>
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-neutral-100 border">
                      {colName(t.columnId)}
                    </span>
                    {typeof t.workDays === 'number' && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-neutral-100 border">
                        {t.workDays}d
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function TaskSummaryChart({
  tasks,
  columns,
  onClose,
}: {
  tasks: Task[];
  columns: Column[];
  onClose: () => void;
}) {
  const data = useMemo(() => {
    const byCol: Record<string, any> = {};
    for (const c of columns) byCol[c.id] = { column: c.name };
    for (const t of tasks) {
      const days = typeof t.workDays === "number" ? t.workDays : 0;
      if (!byCol[t.columnId]) byCol[t.columnId] = { column: "Unknown" };
      byCol[t.columnId][t.status] = (byCol[t.columnId][t.status] || 0) + days;
    }
    return Object.values(byCol);
  }, [tasks, columns]);

  const textExport = useMemo(() => buildTaskSummaryText(tasks, columns), [tasks, columns]);

  return (
    <Sheet open onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-4xl overflow-y-auto print:max-w-full print:w-full print:border-none bg-white">
        <div className="space-y-4">
          <div className="flex items-center gap-3 pr-16 print:pr-0">
            <h2 className="text-xl font-bold">Task Summary</h2>
            <div className="flex gap-2 print:hidden">
              <Button variant="secondary" onClick={() => window.print()}>Print</Button>
              <Button onClick={() => openPrintWindowWithText("Task Summary", textExport)}>Save as PDF</Button>
              <Button variant="outline" onClick={() => copyTextToClipboard(textExport)}>Copy as text</Button>
            </div>
          </div>
          <div className="h-[420px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 80 }}>
                <XAxis type="number" tickFormatter={(v) => `${v}d`} />
                <YAxis type="category" dataKey="column" width={120} />
                <Tooltip formatter={(v: any, name: any) => [`${v}d`, name]} />
                <Legend />
                {STATUS_OPTIONS.map((status) => (
                  <Bar
                    key={status}
                    dataKey={status}
                    stackId="days"
                    fill={STATUS_COLORS[status]}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ================= App =================
const NEW_PROJECT_OPTION = "__new_project__";

export default function App() {
  const isMobile = useIsMobile(768);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState<string>("");

  
  const {
    columns,
    tasks,
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
  } = useBoard(authUserId, currentProjectId);

  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [openColumn, setOpenColumn] = useState<Column | null | undefined>(undefined);
  const [showReport, setShowReport] = useState(false);
  const [showOwner, setShowOwner] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [collapsedPhaseIds, setCollapsedPhaseIds] = useState<Set<string>>(() => new Set());

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const pendingPhotoIdRef = useRef<string | null>(null);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [photoPreviewUri, setPhotoPreviewUri] = useState<string | null>(null);
  const [photoAttachment, setPhotoAttachment] = useState<PhotoAttachment | null>(null);
  const [photoProcessing, setPhotoProcessing] = useState(false);
  const [photoViewer, setPhotoViewer] = useState<PhotoAttachment | null>(null);

  const [users, setUsers] = useState<UserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [photoDefaults, setPhotoDefaults] = useState<{ phaseId: string; assignedUserId: string }>({
    phaseId: "",
    assignedUserId: "",
  });


  // mobile: hamburger menu open
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);



  const isAuthed = !!authUserId;

  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function isPhaseCollapsed(id: string) {
    return collapsedPhaseIds.has(id);
  }

  function togglePhaseCollapsed(id: string) {
    setCollapsedPhaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function collapseAllPhases() {
    setCollapsedPhaseIds(new Set(columns.map((c) => c.id)));
  }

  function expandAllPhases() {
    setCollapsedPhaseIds(new Set());
  }



  // ================= Auth boot + listener =================
  useEffect(() => {
    let mounted = true;

    async function boot() {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (mounted) {
        setAuthUserId(session?.user?.id ?? null);
        setAuthEmail(session?.user?.email ?? null);
        setAuthError(sessionError ? sessionError.message : null);
      }

      const { data: sub } = supabase.auth.onAuthStateChange((_event, session2) => {
        if (!mounted) return;
        setAuthUserId(session2?.user?.id ?? null);
        setAuthEmail(session2?.user?.email ?? null);
        setAuthError(null);

        if (session2?.user?.id) {
          setEmail("");
          setPassword("");
        }
      });

      return () => sub.subscription.unsubscribe();
    }

    let cleanup: any;
    boot().then((fn) => { cleanup = fn; });

    return () => {
      mounted = false;
      if (cleanup) cleanup();
    };
  }, []);

  useEffect(() => {
    if (!photoDefaults.phaseId && columns.length) {
      setPhotoDefaults((prev) => ({ ...prev, phaseId: columns[0].id }));
      return;
    }
    if (photoDefaults.phaseId && columns.length && !columns.some((c) => c.id === photoDefaults.phaseId)) {
      setPhotoDefaults((prev) => ({ ...prev, phaseId: columns[0].id }));
    }
  }, [columns, photoDefaults.phaseId]);

  useEffect(() => {
    if (authUserId && !photoDefaults.assignedUserId) {
      setPhotoDefaults((prev) => ({ ...prev, assignedUserId: authUserId }));
    }
  }, [authUserId, photoDefaults.assignedUserId]);

  useEffect(() => {
    let cancelled = false;

    async function loadUsers() {
      if (!authUserId) {
        if (!cancelled) {
          setUsers([]);
          setUsersLoading(false);
        }
        return;
      }
      setUsersLoading(true);

      try {
        const me: UserOption = { id: authUserId, label: authEmail || "You" };
        if (!cancelled) setUsers([me]);

        const { data, error } = await supabase
          .from("profiles")
          .select("id,full_name,email")
          .order("full_name", { ascending: true });

        if (error) throw error;

        const options: UserOption[] = (data || []).map((u: any) => ({
          id: u.id,
          label: u.full_name || u.email || u.id.slice(0, 8),
        }));

        const unique = new Map<string, UserOption>();
        for (const opt of [me, ...options]) unique.set(opt.id, opt);

        if (!cancelled) setUsers(Array.from(unique.values()));
      } catch (e) {
        console.warn("Falling back to current user list:", e);
        if (!cancelled) {
          setUsers([{ id: authUserId, label: authEmail || "You" }]);
        }
      } finally {
        if (!cancelled) setUsersLoading(false);
      }
    }

    loadUsers();
    return () => {
      cancelled = true;
    };
  }, [authUserId, authEmail]);

  // ================= Load projects from Supabase =================
  useEffect(() => {
    let cancelled = false;

    async function loadProjects() {
      setProjectsLoading(true);

      if (!authUserId) {
        if (!cancelled) {
          setProjects([]);
          setCurrentProjectId("");
          setBoard({ columns: [], tasks: [] });
          setProjectsLoading(false);
        }
        return;
      }

      const { data, error } = await supabase
        .from("projects")
        .select("*")
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error(error);
        setProjects([]);
        setCurrentProjectId("");
        setBoard({ columns: [], tasks: [] });
        setProjectsLoading(false);
        return;
      }

      const rows = (data || []) as ProjectRow[];
      setProjects(rows);

      setCurrentProjectId((prev) => {
        if (prev && rows.some((p) => p.id === prev)) return prev;
        return rows[0]?.id ?? "";
      });

      setProjectsLoading(false);
    }

    loadProjects();
    return () => { cancelled = true; };
  }, [authUserId]);

  // Board loading handled by `useBoard` hook
  // `tasksByColumn` provided by `useBoard`

  // ================= Project CRUD =================
  async function refreshProjectsAndSelect(preferId?: string) {
    const { data, error } = await supabase.from("projects").select("*").order("created_at", { ascending: true });
    if (error) {
      console.error(error);
      return;
    }
    const rows = (data || []) as ProjectRow[];
    setProjects(rows);

    const chosen =
      (preferId && rows.some(p => p.id === preferId) ? preferId : undefined) ||
      (currentProjectId && rows.some(p => p.id === currentProjectId) ? currentProjectId : undefined) ||
      rows[0]?.id ||
      "";

    setCurrentProjectId(chosen);
  }

  async function handleProjectSelect(value: string) {
    if (value === NEW_PROJECT_OPTION) {
      const name = prompt("New project name?", `Project ${projects.length + 1}`)?.trim() || `Project ${projects.length + 1}`;
      if (!authUserId) {
        alert("Please sign in first.");
        return;
      }

      const { data: inserted, error } = await supabase
        .from("projects")
        .insert({ name, user_id: authUserId })
        .select("*")
        .single();

      if (error) {
        console.error(error);
        alert(error.message);
        return;
      }

      try {
        await seedCols(authUserId || "", inserted.id);
      } catch (e: any) {
        console.error(e);
        alert("Project created, but failed to seed columns: " + (e?.message || ""));
      }

      await refreshProjectsAndSelect(inserted.id);
      return;
    }

    setCurrentProjectId(value);
  }

  async function handleRenameCurrentProject() {
    const current = projects.find(p => p.id === currentProjectId);
    if (!current) return;

    const name = prompt("Rename project", current.name)?.trim();
    if (!name) return;

    const { error } = await supabase.from("projects").update({ name }).eq("id", currentProjectId);
    if (error) {
      console.error(error);
      alert(error.message);
      return;
    }

    setProjects(prev => prev.map(p => (p.id === currentProjectId ? { ...p, name } : p)));
  }

  async function handleDuplicateCurrentProject() {
    const current = projects.find(p => p.id === currentProjectId);
    if (!current) return;

    if (!authUserId) {
      alert("Please sign in first.");
      return;
    }

    const name = prompt("Duplicate project as:", `${current.name} copy`)?.trim();
    if (!name) return;

    const { data: inserted, error } = await supabase
      .from("projects")
      .insert({ name, user_id: authUserId })
      .select("*")
      .single();

    if (error) {
      console.error(error);
      alert(error.message);
      return;
    }

    const colMap = new Map<string, string>();
    const clonedCols = columns.map((c, idx) => {
      const newId = uuid();
      colMap.set(c.id, newId);
      return {
        id: newId,
        user_id: authUserId,
        project_id: inserted.id,
        name: c.name,
        sort_order: idx,
      };
    });

    const { error: colErr } = await supabase.from("project_columns").insert(clonedCols);
    if (colErr) {
      console.error(colErr);
      alert(colErr.message);
      return;
    }

    const perColOrder = computeTaskSortOrders(columns, tasks);
    const clonedTasksPayload = tasks.map((t) => ({
      id: uuid(),
      user_id: authUserId,
      project_id: inserted.id,
      column_id: colMap.get(t.columnId) || t.columnId,
      title: t.title,
      notes: buildTaskNotes(t.notes, {
        phaseId: t.phaseId || t.columnId,
        assignedUserId: t.assignedUserId,
        startDate: t.startDate,
        endDate: t.endDate,
        photo: t.photo,
      }),
      status: t.status,
      work_days: typeof t.workDays === "number" ? t.workDays : null,
      sort_order: perColOrder[t.id] ?? 0,
    }));

    if (clonedTasksPayload.length) {
      const { error: tErr } = await supabase.from("tasks").insert(clonedTasksPayload);
      if (tErr) {
        console.error(tErr);
        alert(tErr.message);
        return;
      }
    }

    await refreshProjectsAndSelect(inserted.id);
  }

  async function handleDeleteCurrentProject() {
    if (projects.length <= 1) {
      alert("You must have at least one project.");
      return;
    }

    const current = projects.find(p => p.id === currentProjectId);
    const name = current?.name || "current project";
    if (!confirm(`Delete project "${name}"?`)) return;

    const { error } = await supabase.from("projects").delete().eq("id", currentProjectId);
    if (error) {
      console.error(error);
      alert(error.message);
      return;
    }

    const remaining = projects.filter(p => p.id !== currentProjectId);
    const nextId = remaining[0]?.id || "";
    await refreshProjectsAndSelect(nextId);
  }

  // ================= Phases / Tasks =================
  

  function addColumn() {
    setOpenColumn({ id: "", name: "" });
  }

  
  

  function handleExportCsv() {
    const header = ["Phase", "Title", "Status", "WorkDays"];
    const colName = (id: string) => columns.find(c => c.id === id)?.name || "";
    const rows = [header];
    for (const t of tasks) {
      rows.push([
        colName(t.columnId),
        t.title,
        t.status,
        typeof t.workDays === "number" ? String(t.workDays) : ""
      ]);
    }
    const csv = rows.map(r => r.map(escapeCsv).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "lookahead-tasks.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportCsv() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".csv,text/csv";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = String(reader.result);
          const rows = parseCsv(text);
          if (!rows.length) return;
          const [header, ...dataRows] = rows;
          const colIndex = header.findIndex(h => {
            const key = h.toLowerCase();
            return key === "phase" || key === "column";
          });
          const titleIndex = header.findIndex(h => h.toLowerCase() === "title");
          const statusIndex = header.findIndex(h => h.toLowerCase() === "status");
          const daysIndex = header.findIndex(h => h.toLowerCase() === "workdays");

          if (titleIndex === -1 || colIndex === -1) {
            alert("CSV must include at least 'Phase' (or 'Column') and 'Title' headers.");
            return;
          }

          const newColumnsMap = new Map<string, Column>();
          const newTasks: Task[] = [];

          for (const row of dataRows) {
            const colName = row[colIndex]?.trim();
            const title = row[titleIndex]?.trim();
            if (!title) continue;

            const columnName = colName || "General";
            if (!newColumnsMap.has(columnName)) {
              newColumnsMap.set(columnName, { id: uuid(), name: columnName });
            }
            const column = newColumnsMap.get(columnName)!;

            const statusStr = statusIndex >= 0 ? row[statusIndex] || "" : "";
            const status = normalizeStatus(statusStr);

            const daysStr = daysIndex >= 0 ? row[daysIndex] || "" : "";
            const daysNum = daysStr ? Math.max(0, Math.floor(Number(daysStr))) : undefined;

            newTasks.push({
              id: uuid(),
              title,
              columnId: column.id,
              phaseId: column.id,
              assignedUserId: authUserId || "",
              startDate: undefined,
              endDate: undefined,
              photo: undefined,
              status,
              workDays: daysNum,
            });
          }

          const newColumns = Array.from(newColumnsMap.values());
          if (!newColumns.length) {
            alert("No tasks found in CSV.");
            return;
          }

          const next = { columns: newColumns, tasks: newTasks };
          setBoard(next);
          scheduleSaveBoard(next.columns, next.tasks);
        } catch (e) {
          console.error(e);
          alert("There was a problem importing the CSV.");
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  function triggerCamera() {
    cameraInputRef.current?.click();
  }

  function handleCameraCapture(file: File) {
    const previewUrl = URL.createObjectURL(file);
    setPhotoPreviewUri((prev) => {
      if (prev && prev !== previewUrl) URL.revokeObjectURL(prev);
      return previewUrl;
    });
    setPhotoAttachment(null);
    setPhotoProcessing(true);

    const photoId = uuid();
    pendingPhotoIdRef.current = photoId;

    const reader = new FileReader();
    reader.onload = () => {
      if (pendingPhotoIdRef.current !== photoId) return;
      const dataUrl = String(reader.result || "");
      setPhotoAttachment({ id: photoId, uri: dataUrl });
      setPhotoProcessing(false);
    };
    reader.onerror = () => {
      if (pendingPhotoIdRef.current !== photoId) return;
      setPhotoProcessing(false);
    };
    reader.readAsDataURL(file);

    setPhotoModalOpen(true);
  }

  function handleClosePhotoModal() {
    setPhotoModalOpen(false);
    setPhotoAttachment(null);
    setPhotoProcessing(false);
    pendingPhotoIdRef.current = null;
    setPhotoPreviewUri((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }

  function handleSavePhotoTask(payload: {
    title: string;
    phaseId: string;
    assignedUserId: string;
    startDate?: string;
    endDate?: string;
    photo: PhotoAttachment;
  }) {
    const assignedUserId = payload.assignedUserId || authUserId || "";
    saveTask({
      id: "",
      title: payload.title,
      columnId: payload.phaseId,
      phaseId: payload.phaseId,
      assignedUserId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      photo: payload.photo,
      status: "Unassigned",
      workDays: undefined,
    });
  }

  function handleReportSelect(value: string) {
    if (value === "threeWeek") setShowReport(true);
    else if (value === "ownerUpdate") setShowOwner(true);
    else if (value === "taskSummary") setShowSummary(true);
  }

  return (
    <div className="min-h-screen w-full max-w-[100vw] bg-white overflow-x-hidden">
      <CameraTaskButton
        onCapture={handleCameraCapture}
        inputRef={cameraInputRef}
        disabled={false}
      />
      <div
        className="w-full max-w-[100vw] mx-auto px-3 sm:px-6 pb-4 space-y-4 overflow-x-hidden"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 72px)" }}
      >
        <header
          className="sticky top-0 z-20 bg-white pb-3 overflow-x-hidden"
          style={{ top: "calc(env(safe-area-inset-top) + 72px)" }}
        >
          <div className="flex flex-wrap items-start gap-3 max-w-[100vw] min-w-0">
            <div className="flex flex-col gap-2 w-full max-w-[100vw] min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold flex items-center gap-2">
                <Columns className="h-5 w-5" /> Integrated Look Ahead
              </h1>

              {/* ================= MOBILE HEADER (clean, hamburger) ================= */}
              {isMobile ? (
                <div className="inline-flex rounded-2xl border bg-neutral-50 px-3 py-2 w-full max-w-[100vw] overflow-x-hidden">
                  <div className="flex items-center gap-2 w-full min-w-0">
                    {/* Project dropdown stays visible */}
                    <div className="flex-1 min-w-0">
                      <Select value={currentProjectId} onValueChange={handleProjectSelect} disabled={!isAuthed}>
                        <SelectTrigger className="w-full bg-white">
                          <SelectValue placeholder={projectsLoading ? "Loading..." : (isAuthed ? "Select project" : "Sign in")} />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          {projects.map(p => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                          <SelectItem value={NEW_PROJECT_OPTION}>
                            + New project…
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Hamburger menu */}
                    <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
                      <SheetTrigger asChild>
                        <Button variant="secondary" className="rounded-full shrink-0">
                          <Menu className="h-5 w-5" />
                        </Button>
                      </SheetTrigger>

                      <SheetContent side="right" className="w-[85vw] bg-white overflow-y-auto">
                        <SheetHeader>
                          <SheetTitle>Menu</SheetTitle>
                        </SheetHeader>

                        <div className="mt-4 space-y-6">
                          {/* Account */}
                          <div className="space-y-2">
                            <div className="text-sm font-semibold">Account</div>

                            {!isAuthed ? (
                              <div className="rounded-2xl border bg-neutral-50 p-3 space-y-2">
                                <div className="flex flex-col">
                                  <label className="text-xs opacity-70">Email</label>
                                  <Input
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder="you@email.com"
                                    className="bg-white"
                                  />
                                </div>

                                <div className="flex flex-col">
                                  <label className="text-xs opacity-70">Password</label>
                                  <Input
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    type="password"
                                    placeholder="Password"
                                    className="bg-white"
                                  />
                                </div>

                                <div className="flex gap-2">
                                  <Button
                                    className="rounded-full bg-neutral-800 text-white hover:bg-neutral-700 flex-1"
                                    onClick={async () => {
                                      setAuthError(null);
                                      const { error } = await supabase.auth.signUp({ email, password });
                                      if (error) setAuthError(error.message);
                                      else alert("Signed up. Now click Sign In.");
                                    }}
                                  >
                                    Sign Up
                                  </Button>

                                  <Button
                                    className="rounded-full bg-neutral-800 text-white hover:bg-neutral-700 flex-1"
                                    onClick={async () => {
                                      setAuthError(null);
                                      const { error } = await supabase.auth.signInWithPassword({ email, password });
                                      if (error) setAuthError(error.message);
                                      else setMobileMenuOpen(false);
                                    }}
                                  >
                                    Sign In
                                  </Button>
                                </div>

                                {authError && (
                                  <div className="text-sm text-rose-600">
                                    {authError}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="rounded-2xl border bg-neutral-50 p-3 space-y-2">
                                <div className="text-xs opacity-70 break-words">
                                  Signed in as <strong>{authEmail || authUserId?.slice(0, 8) + "..."}</strong>
                                </div>
                                <Button
                                  variant="secondary"
                                  className="rounded-full w-full justify-start"
                                  onClick={async () => {
                                    await supabase.auth.signOut();
                                    setCurrentProjectId("");
                                    setBoard({ columns: [], tasks: [] });
                                    setMobileMenuOpen(false);
                                  }}
                                >
                                  <LogOut className="h-4 w-4 mr-2" /> Sign Out
                                </Button>
                              </div>
                            )}
                          </div>

                          {/* Project actions */}
                          <div className="space-y-2">
                            <div className="text-sm font-semibold">Project</div>
                            <Button
                              onClick={() => { setMobileMenuOpen(false); handleRenameCurrentProject(); }}
                              className="rounded-full w-full justify-start bg-neutral-800 text-white hover:bg-neutral-700"
                              disabled={!currentProjectId || !isAuthed}
                            >
                              Rename Project
                            </Button>
                            <Button
                              onClick={() => { setMobileMenuOpen(false); handleDuplicateCurrentProject(); }}
                              className="rounded-full w-full justify-start bg-neutral-800 text-white hover:bg-neutral-700"
                              disabled={!currentProjectId || !isAuthed}
                            >
                              Duplicate Project
                            </Button>
                            <Button
                              onClick={() => { setMobileMenuOpen(false); handleDeleteCurrentProject(); }}
                              className="rounded-full w-full justify-start bg-neutral-800 text-white hover:bg-neutral-700"
                              disabled={!currentProjectId || projects.length <= 1 || !isAuthed}
                            >
                              Delete Project
                            </Button>
                          </div>

                          {/* Reports */}
                          <div className="space-y-2">
                            <div className="text-sm font-semibold">Reports</div>
                            <Select
                              onValueChange={(v) => {
                                setMobileMenuOpen(false);
                                handleReportSelect(v);
                              }}
                              disabled={!currentProjectId}
                            >
                              <SelectTrigger className="w-full bg-white">
                                <SelectValue placeholder="Reports" />
                              </SelectTrigger>
                              <SelectContent className="bg-white">
                                <SelectItem value="threeWeek">3 Week Look Ahead</SelectItem>
                                <SelectItem value="ownerUpdate">Owner Update</SelectItem>
                                <SelectItem value="taskSummary">Task Summary</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Phases */}
                          <div className="space-y-2">
                            <div className="text-sm font-semibold">Phases</div>
                            <Button
                              className="rounded-full w-full justify-start bg-neutral-800 text-white hover:bg-neutral-700"
                              onClick={() => {
                                setMobileMenuOpen(false);
                                addColumn();
                              }}
                              disabled={!currentProjectId || !isAuthed}
                            >
                              <Plus className="h-4 w-4 mr-2" /> New Phase
                            </Button>
                            <Button
                              variant="secondary"
                              className="rounded-full w-full justify-start"
                              onClick={() => {
                                collapseAllPhases();
                                setMobileMenuOpen(false);
                              }}
                              disabled={columns.length === 0}
                            >
                              Collapse All
                            </Button>
                            <Button
                              variant="secondary"
                              className="rounded-full w-full justify-start"
                              onClick={() => {
                                expandAllPhases();
                                setMobileMenuOpen(false);
                              }}
                              disabled={columns.length === 0}
                            >
                              Expand All
                            </Button>
                          </div>

                          {/* Data */}
                          <div className="space-y-2">
                            <div className="text-sm font-semibold">Data</div>
                            <Button
                              className="rounded-full w-full justify-start bg-neutral-800 text-white hover:bg-neutral-700"
                              onClick={() => { setMobileMenuOpen(false); handleExportCsv(); }}
                              disabled={!currentProjectId}
                            >
                              <Upload className="h-4 w-4 mr-2" /> Export
                            </Button>
                            <Button
                              className="rounded-full w-full justify-start bg-neutral-800 text-white hover:bg-neutral-700"
                              onClick={() => { setMobileMenuOpen(false); handleImportCsv(); }}
                              disabled={!currentProjectId || !isAuthed}
                            >
                              <Download className="h-4 w-4 mr-2" /> Import
                            </Button>
                          </div>

                          {boardLoading && (
                            <div className="text-xs opacity-60">Loading board…</div>
                          )}
                          {boardError && (
                            <div className="text-sm text-rose-600">
                              {boardError}
                            </div>
                          )}
                        </div>
                      </SheetContent>
                    </Sheet>
                  </div>
                </div>
              ) : (
                /* ================= DESKTOP HEADER (keep your existing layout) ================= */
                <>
                  {!isAuthed ? (
                    <div className="rounded-2xl border bg-neutral-50 p-3 flex flex-wrap items-end gap-2 max-w-[100vw] overflow-x-hidden">
                      <div className="flex flex-col">
                        <label className="text-xs opacity-70">Email</label>
                        <Input
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@email.com"
                          className="w-[240px] bg-white"
                        />
                      </div>

                      <div className="flex flex-col">
                        <label className="text-xs opacity-70">Password</label>
                        <Input
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          type="password"
                          placeholder="Password"
                          className="w-[200px] bg-white"
                        />
                      </div>

                      <div className="flex gap-2">
                        <Button
                          className="rounded-full bg-neutral-800 text-white hover:bg-neutral-700"
                          onClick={async () => {
                            setAuthError(null);
                            const { error } = await supabase.auth.signUp({ email, password });
                            if (error) setAuthError(error.message);
                            else alert("Signed up. Now click Sign In.");
                          }}
                        >
                          Sign Up
                        </Button>

                        <Button
                          className="rounded-full bg-neutral-800 text-white hover:bg-neutral-700"
                          onClick={async () => {
                            setAuthError(null);
                            const { error } = await supabase.auth.signInWithPassword({ email, password });
                            if (error) setAuthError(error.message);
                          }}
                        >
                          Sign In
                        </Button>
                      </div>

                      {authError && (
                        <div className="w-full text-sm text-rose-600">
                          {authError}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="rounded-2xl border bg-neutral-50 px-3 py-2 flex items-center justify-between gap-3 max-w-[100vw] overflow-x-hidden">
                      <div className="text-xs opacity-70">
                        Signed in as <strong>{authEmail || authUserId?.slice(0, 8) + "..."}</strong>
                      </div>
                      <Button
                        variant="secondary"
                        className="rounded-full"
                        onClick={async () => {
                          await supabase.auth.signOut();
                          setCurrentProjectId("");
                          setBoard({ columns: [], tasks: [] });
                        }}
                      >
                        <LogOut className="h-4 w-4 mr-1" /> Sign Out
                      </Button>
                    </div>
                  )}

                  <div className="inline-flex rounded-2xl border bg-neutral-50 px-3 py-2 w-full max-w-[100vw] overflow-x-hidden">
                    <div className="flex flex-col gap-2 w-full max-w-[100vw] overflow-x-hidden min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs uppercase tracking-wide opacity-60">Project</span>
                        <Select value={currentProjectId} onValueChange={handleProjectSelect} disabled={!isAuthed}>
                          <SelectTrigger className="w-[220px] bg-white">
                            <SelectValue placeholder={projectsLoading ? "Loading..." : (isAuthed ? "Select project" : "Sign in")} />
                          </SelectTrigger>
                          <SelectContent className="bg-white">
                            {projects.map(p => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                            <SelectItem value={NEW_PROJECT_OPTION}>
                              + New project…
                            </SelectItem>
                          </SelectContent>
                        </Select>

                        <div className="flex gap-1">
                          <Button
                            onClick={handleRenameCurrentProject}
                            className="bg-neutral-800 text-white hover:bg-neutral-700 rounded-full"
                            disabled={!currentProjectId || !isAuthed}
                          >
                            Rename
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={handleDuplicateCurrentProject}
                            className="bg-neutral-800 text-white hover:bg-neutral-700 rounded-full"
                            disabled={!currentProjectId || !isAuthed}
                          >
                            Duplicate
                          </Button>
                          <Button
                            variant="secondary"
                            onClick={handleDeleteCurrentProject}
                            className="bg-neutral-800 text-white hover:bg-neutral-700 rounded-full"
                            disabled={!currentProjectId || projects.length <= 1 || !isAuthed}
                          >
                            Delete
                          </Button>
                        </div>

                        {boardLoading && <span className="text-xs opacity-60 ml-2">Loading board…</span>}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 justify-start">
                        <Select onValueChange={handleReportSelect} disabled={!currentProjectId}>
                          <SelectTrigger className="w-[160px] bg-white">
                            <SelectValue placeholder="Reports" />
                          </SelectTrigger>
                          <SelectContent className="bg-white">
                            <SelectItem value="threeWeek">3 Week Look Ahead</SelectItem>
                            <SelectItem value="ownerUpdate">Owner Update</SelectItem>
                            <SelectItem value="taskSummary">Task Summary</SelectItem>
                          </SelectContent>
                        </Select>

                        <Button
                          variant="secondary"
                          className="rounded-full bg-neutral-800 text-white hover:bg-neutral-700"
                          onClick={addColumn}
                          disabled={!currentProjectId || !isAuthed}
                        >
                          <Plus className="h-4 w-4 mr-1" /> New Phase
                        </Button>
                        <Button
                          variant="secondary"
                          className="rounded-full bg-neutral-800 text-white hover:bg-neutral-700"
                          onClick={handleExportCsv}
                          disabled={!currentProjectId}
                        >
                          <Upload className="h-4 w-4 mr-1" /> Export
                        </Button>
                        <Button
                          variant="secondary"
                          className="rounded-full bg-neutral-800 text-white hover:bg-neutral-700"
                          onClick={handleImportCsv}
                          disabled={!currentProjectId || !isAuthed}
                        >
                          <Download className="h-4 w-4 mr-1" /> Import
                        </Button>
                      </div>

                      {boardError && (
                        <div className="text-sm text-rose-600">
                          {boardError}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

            </div>
          </div>
        </header>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="w-full border rounded-2xl bg-white p-4 sm:p-6">
            <SortableContext
              items={columns.map((c) => `col:${c.id}`)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-2 w-full">
                {columns.length === 0 ? (
                  <div className="text-sm opacity-60">No phases yet.</div>
                ) : (
                  columns.map((c) => {
                    const items = tasksByColumn[c.id] || [];
                    return (
                      <div key={c.id} className="w-full">
                        <SortableColumn column={c}>
                          {({ setActivatorNodeRef, attributes, listeners }) => (
                            <div className="bg-transparent rounded-none shadow-none p-0 border-b border-neutral-200">
                              {/* Phase Header as Section Title */}
                              <div className="mb-3 pb-2 border-b-2 border-neutral-300">
                                <div className="flex items-center gap-2">
                                  <div
                                    ref={setActivatorNodeRef}
                                    {...attributes}
                                    {...listeners}
                                    className="flex items-center gap-1 px-2 py-1 rounded-full border border-dashed border-neutral-300 text-[11px] uppercase tracking-wide text-neutral-500 cursor-grab active:cursor-grabbing select-none bg-white/60"
                                    aria-label="Move Phase"
                                    title="Move Phase"
                                  >
                                    <GripVertical className="h-3 w-3" />
                                  </div>
                                  <div
                                    className="text-base font-bold text-neutral-800 hover:underline cursor-pointer flex-1"
                                    onClick={() => setOpenColumn(c)}
                                  >
                                    {c.name}
                                  </div>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0"
                                    onClick={() => togglePhaseCollapsed(c.id)}
                                    title={isPhaseCollapsed(c.id) ? "Expand Phase" : "Collapse Phase"}
                                    aria-label={isPhaseCollapsed(c.id) ? "Expand Phase" : "Collapse Phase"}
                                  >
                                    {isPhaseCollapsed(c.id) ? (
                                      <ChevronRight className="h-4 w-4" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4" />
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-8 w-8 p-0"
                                    onClick={() => setOpenTask({
                                      id: "",
                                      title: "",
                                      columnId: c.id,
                                      phaseId: c.id,
                                      assignedUserId: authUserId || "",
                                      startDate: undefined,
                                      endDate: undefined,
                                      photo: undefined,
                                      status: "Unassigned",
                                      workDays: undefined,
                                    })}
                                    title="Add Task"
                                  >
                                    <Plus className="h-4 w-4" />
                                  </Button>
                                </div>
                              </div>

                              {!isPhaseCollapsed(c.id) && (
                                <>
                                  {/* Tasks Container - Indented */}
                                  <ColumnDropZone columnId={c.id}>
                                    <div className="w-full pl-6 space-y-2 mb-4">
                                      <SortableContext items={items.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                                        {items.map((t) => (
                                          <SortableTask
                                            key={t.id}
                                            task={t}
                                            onEdit={(tk) => setOpenTask(tk)}
                                            onDelete={(id) => deleteTask(id)}
                                            onRename={saveTask}
                                            onViewPhoto={(photo) => setPhotoViewer(photo)}
                                          />
                                        ))}
                                      </SortableContext>
                                      <QuickAddTask
                                        columnId={c.id}
                                        onCreate={(columnId, title) =>
                                          saveTask({
                                            id: "",
                                            title,
                                            columnId,
                                            phaseId: columnId,
                                            assignedUserId: authUserId || "",
                                            startDate: undefined,
                                            endDate: undefined,
                                            photo: undefined,
                                            status: "Unassigned",
                                            workDays: undefined,
                                          })
                                        }
                                      />
                                    </div>
                                  </ColumnDropZone>

                                  <div className="flex justify-end mb-4">
                                    <Button
                                      variant="secondary"
                                      size="sm"
                                      className="text-xs"
                                      onClick={() => removeColumn(c.id)}
                                    >
                                      <Trash2 className="h-3 w-3 mr-1" /> Remove Phase
                                    </Button>
                                  </div>
                                </>
                              )}
                            </div>
                          )}
                        </SortableColumn>
                      </div>
                    );
                  })
                )}
              </div>
            </SortableContext>
          </div>
        </DndContext>
      </div>

      {showReport && <ThreeWeekReport tasks={tasks} columns={columns} onClose={() => setShowReport(false)} />}
      {showOwner && <OwnerUpdateReport tasks={tasks} columns={columns} onClose={() => setShowOwner(false)} />}
      {showSummary && <TaskSummaryChart tasks={tasks} columns={columns} onClose={() => setShowSummary(false)} />}

      <PhotoTaskModal
        open={photoModalOpen}
        photoPreviewUri={photoPreviewUri}
        photo={photoAttachment}
        photoProcessing={photoProcessing}
        phases={columns}
        users={users}
        usersLoading={usersLoading}
        defaultPhaseId={photoDefaults.phaseId}
        defaultAssignedUserId={photoDefaults.assignedUserId}
        onClose={handleClosePhotoModal}
        onSave={handleSavePhotoTask}
        onRequestPhoto={triggerCamera}
        onPhaseChange={(value) => setPhotoDefaults((prev) => ({ ...prev, phaseId: value }))}
        onAssignedChange={(value) => setPhotoDefaults((prev) => ({ ...prev, assignedUserId: value }))}
      />
      <TaskPhotoViewer
        open={!!photoViewer}
        photo={photoViewer}
        onClose={() => setPhotoViewer(null)}
      />

      <TaskEditor openTask={openTask} onSave={saveTask} onClose={() => setOpenTask(null)} />
      {openColumn !== undefined && (
        <ColumnEditor
          initial={openColumn ?? null}
          onSave={(col) => {
            const id = col.id || uuid();
            const exists = columns.some(c => c.id === id);

            const nextCols = exists
              ? columns.map(c => (c.id === id ? { ...c, name: col.name } : c))
              : [...columns, { id, name: col.name }];

            const next = { columns: nextCols, tasks };
            setBoard(next);

            scheduleSaveBoard(next.columns, next.tasks);
          }}
          onClose={() => setOpenColumn(undefined)}
        />
      )}
    </div>
  );
}
