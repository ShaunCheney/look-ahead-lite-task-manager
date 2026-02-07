import { supabase } from "./supabaseClient";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { v4 as uuid } from "uuid";
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useBoard } from "./hooks/useBoard";
import { buildTaskNotes, computeTaskSortOrders, seedDefaultColumnsInSupabase as seedCols, type PhotoAttachment, type Task, type TaskStatus } from "./board/boardService";
import { CameraTaskButton, TaskPhotoViewer, type UserOption } from "./components/photo-task";

import {
  Plus,
  Pencil,
  Camera,
  Mic,
  ImagePlus,
  X,
  GripVertical,
  Columns,
  Download,
  Upload,
  FileText,
  Trash2,
  ChevronRight,
  ChevronDown,
  LogOut,
  Menu,
  Loader2
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
  "Future Work",
  "Closed",
];

const MANUAL_STATUS_OPTIONS: TaskStatus[] = [
  "Unassigned",
  "In Process",
  "Completed",
  "Closed",
];

const STATUS_AUTO_VALUE = "__auto__";

const SORT_STATUS_ORDER: TaskStatus[] = [
  "Unassigned",
  "Closed",
  "In Process",
  "Completed",
  "This week",
  "Next week",
  "Week After",
  "Future Work",
  "Delayed/Overdue",
];

const SORT_STATUS_INDEX = new Map<TaskStatus, number>(
  SORT_STATUS_ORDER.map((status, index) => [status, index])
);

// ================= Status styling =================
function getStatusClasses(status: TaskStatus) {
  switch (status) {
    case "Completed":
      return { card: "bg-emerald-50 border-emerald-100 opacity-70", chip: "bg-emerald-100 text-emerald-800 border-emerald-200 opacity-70" };
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
    case "Future Work":
      return { card: "bg-cyan-50 border-cyan-100", chip: "bg-cyan-100 text-cyan-800 border-cyan-200" };
    case "Closed":
      return { card: "bg-neutral-50 border-neutral-200 opacity-70", chip: "bg-neutral-200 text-neutral-700 border-neutral-300 opacity-70" };
    case "Unassigned":
    default:
      return { card: "bg-slate-50 border-slate-200", chip: "bg-slate-200 text-slate-700 border-slate-300" };
  }
}

const DEFAULT_STATUS_TONE = getStatusClasses("Unassigned");

// pastel fills for the chart
const STATUS_COLORS: Record<TaskStatus, string> = {
  "Completed": "#A7F3D0",
  "In Process": "#BAE6FD",
  "Delayed/Overdue": "#FECACA",
  "This week": "#FDE68A",
  "Next week": "#C7D2FE",
  "Week After": "#F5D0FE",
  "Future Work": "#A5F3FC",
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

function toIsoDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseIsoDate(value?: string): Date | null {
  if (!value) return null;
  if (value.includes("T")) {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function toDateInputValue(value?: string): string {
  const parsed = parseIsoDate(value);
  return parsed ? toIsoDateString(parsed) : "";
}

function normalizeDateInput(value: string): string | undefined {
  const parsed = parseIsoDate(value);
  return parsed ? toIsoDateString(parsed) : undefined;
}

function buildInitials(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
  const start = startOfDay(date);
  const day = start.getDay();
  start.setDate(start.getDate() - day);
  return start;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getTaskStatusDate(task: Task): Date | null {
  const date = task.endDate || task.startDate;
  return parseIsoDate(date);
}

function getDerivedStatus(task: Task, today = new Date()): TaskStatus | null {
  const targetDate = getTaskStatusDate(task);
  if (!targetDate) return null;

  const todayStart = startOfDay(today);
  const targetStart = startOfDay(targetDate);
  if (targetStart < todayStart) return "Delayed/Overdue";

  const thisWeekStart = startOfWeek(todayStart);
  const nextWeekStart = addDays(thisWeekStart, 7);
  const weekAfterStart = addDays(thisWeekStart, 14);
  const weekAfterNextStart = addDays(thisWeekStart, 21);

  if (targetStart >= thisWeekStart && targetStart < nextWeekStart) return "This week";
  if (targetStart >= nextWeekStart && targetStart < weekAfterStart) return "Next week";
  if (targetStart >= weekAfterStart && targetStart < weekAfterNextStart) return "Week After";
  // Future Work is derived only from a valid start date beyond the current week ranges.
  const startDate = parseIsoDate(task.startDate);
  if (startDate) {
    const startDay = startOfDay(startDate);
    if (startDay >= weekAfterNextStart) return "Future Work";
  }
  return null;
}

function getDisplayStatus(task: Task, today = new Date()): TaskStatus {
  if (task.statusOverride && task.statusOverride !== "Future Work") return task.statusOverride;
  if (task.status === "Completed" || task.status === "Closed") return task.status;
  const derived = getDerivedStatus(task, today);
  return derived ?? task.status;
}

function getDisplayStatusFromCache(task: Task, today: Date, cache?: Map<string, TaskStatus>): TaskStatus {
  return cache?.get(task.id) ?? getDisplayStatus(task, today);
}

function compareTasks(a: Task, b: Task, today = new Date(), statusCache?: Map<string, TaskStatus>): number {
  const statusA = getDisplayStatusFromCache(a, today, statusCache);
  const statusB = getDisplayStatusFromCache(b, today, statusCache);
  const orderA = SORT_STATUS_INDEX.get(statusA) ?? Number.MAX_SAFE_INTEGER;
  const orderB = SORT_STATUS_INDEX.get(statusB) ?? Number.MAX_SAFE_INTEGER;
  if (orderA !== orderB) return orderA - orderB;

  const dateA = getTaskStatusDate(a);
  const dateB = getTaskStatusDate(b);
  if (dateA && dateB) {
    const diff = dateA.getTime() - dateB.getTime();
    if (diff !== 0) return diff;
  } else if (dateA) {
    return -1;
  } else if (dateB) {
    return 1;
  }

  const titleDiff = a.title.localeCompare(b.title);
  if (titleDiff !== 0) return titleDiff;
  return a.id.localeCompare(b.id);
}

function sortTasks(tasks: Task[], today = new Date(), statusCache?: Map<string, TaskStatus>): Task[] {
  return [...tasks].sort((a, b) => compareTasks(a, b, today, statusCache));
}

function groupTasksByColumn(tasks: Task[], columns: Column[], today = new Date(), statusCache?: Map<string, TaskStatus>): Record<string, Task[]> {
  const map: Record<string, Task[]> = Object.fromEntries(columns.map((c) => [c.id, [] as Task[]]));
  for (const t of tasks) {
    (map[t.columnId] ||= []).push(t);
  }
  for (const colId of Object.keys(map)) {
    map[colId] = sortTasks(map[colId], today, statusCache);
  }
  return map;
}

function computeEndDate(startDateIso: string, workDays?: number): string | undefined {
  if (typeof workDays !== "number") return undefined;
  const start = parseIsoDate(startDateIso);
  if (!start) return undefined;
  const safeDays = Math.max(0, Math.floor(workDays));
  if (safeDays <= 0) return toIsoDateString(start);
  const end = addDays(start, safeDays - 1);
  return toIsoDateString(end);
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
type TaskCardProps = {
  task: Task;
  displayStatus: TaskStatus;
  tone: ReturnType<typeof getStatusClasses>;
  onEdit: (t: Task) => void;
  onDelete: (id: string) => void;
  onRename: (t: Task) => void;
  onViewPhoto?: (photos: PhotoAttachment[], startIndex: number) => void;
  assignedLabel?: string;
};

const TaskCard = memo(function TaskCard({
  task,
  displayStatus,
  tone,
  onEdit,
  onDelete,
  onRename,
  onViewPhoto,
  assignedLabel,
}: TaskCardProps) {
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const photos = task.photos || [];
  const primaryPhoto = photos[0];
  const canViewPhoto = !!primaryPhoto && !!onViewPhoto;
  const assignedInitials = assignedLabel ? buildInitials(assignedLabel) : "";
  const assignedDisplay = assignedLabel
    ? (assignedLabel.length <= 8 ? assignedLabel : (assignedInitials || assignedLabel))
    : "";
  const percentComplete = (() => {
    if (typeof task.percentComplete !== "number" || Number.isNaN(task.percentComplete) || !Number.isFinite(task.percentComplete)) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(task.percentComplete)));
  })();

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
    <div className="mb-2">
      <Card className={`rounded-lg shadow-sm border text-sm ${tone.card}`}>
        <CardContent className="p-2">
          <div className="flex justify-between items-start gap-2 mb-1">
            <div className="flex flex-wrap items-center gap-1 min-w-0">
              <Badge className={`rounded-full text-[9px] px-1.5 py-0.5 border pointer-events-none ${tone.chip}`}>
                {displayStatus}
              </Badge>
              {assignedDisplay && (
                <Badge
                  className="rounded-full text-[9px] px-1.5 py-0.5 border bg-white/70 text-neutral-700 border-neutral-300 pointer-events-none"
                  title={assignedLabel}
                >
                  {assignedDisplay}
                </Badge>
              )}
              {typeof task.workDays === "number" && (
                <Badge className={`rounded-full text-[9px] px-1.5 py-0.5 border pointer-events-none ${tone.chip}`}>
                  {task.workDays}d
                </Badge>
              )}
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {canViewPhoto && (
                <Button
                  variant="ghost"
                  className="h-11 w-11 p-0 rounded-full sm:h-8 sm:w-8"
                  onClick={() => {
                    if (!photos.length || !onViewPhoto) return;
                    onViewPhoto(photos, 0);
                  }}
                  title="View photo"
                >
                  <Camera className="h-3 w-3" />
                </Button>
              )}
              <span className="text-[10px] font-semibold tabular-nums text-neutral-600 self-center">
                {percentComplete}%
              </span>
              <Button variant="ghost" className="h-11 w-11 p-0 rounded-full sm:h-8 sm:w-8" onClick={() => onEdit(task)}>
                <Pencil className="h-4 w-4" />
              </Button>
              <Button variant="ghost" className="h-11 w-11 p-0 rounded-full sm:h-8 sm:w-8" onClick={() => onDelete(task.id)}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* No photo thumbnails in the list view for faster initial rendering. */}
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
}, (prev, next) => (
  prev.task === next.task &&
  prev.displayStatus === next.displayStatus &&
  prev.tone === next.tone &&
  prev.assignedLabel === next.assignedLabel &&
  prev.onEdit === next.onEdit &&
  prev.onDelete === next.onDelete &&
  prev.onRename === next.onRename &&
  prev.onViewPhoto === next.onViewPhoto
));

function SortableColumn({
  column,
  children,
}: {
  column: Column;
  children: (args: {
    setActivatorNodeRef: (element: HTMLElement | null) => void;
    attributes: any;
    listeners: any;
  }) => ReactNode;
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

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children({ setActivatorNodeRef, attributes, listeners })}
    </div>
  );
}


function TaskEditor({
  openTask,
  onSave,
  onClose,
  columns,
  users,
  usersLoading,
  incomingPhotos,
  onConsumeIncomingPhotos,
  onRequestCamera,
  onRequestFiles,
  onPhaseChange,
  onAssignedChange,
  isMobile,
}: {
  openTask: Task | null;
  onSave: (t: Task) => void;
  onClose: () => void;
  columns: Column[];
  users: UserOption[];
  usersLoading: boolean;
  incomingPhotos: PhotoAttachment[];
  onConsumeIncomingPhotos: () => void;
  onRequestCamera: (onPhotos: (photos: PhotoAttachment[]) => void) => void;
  onRequestFiles: (onPhotos: (photos: PhotoAttachment[]) => void) => void;
  onPhaseChange?: (value: string) => void;
  onAssignedChange?: (value: string) => void;
  isMobile: boolean;
}) {
  const [draft, setDraft] = useState<Task | null>(openTask);
  const [photoViewer, setPhotoViewer] = useState<{ photos: PhotoAttachment[]; index: number } | null>(null);
  const [isDictating, setIsDictating] = useState(false);
  const recognitionRef = useRef<any>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  function stopDictation() {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.onresult = null;
        recognitionRef.current.onend = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.stop();
      } catch {
        // no-op
      }
      recognitionRef.current = null;
    }
    setIsDictating(false);
  }

  function startTitleDictation() {
    const SpeechRecognition = (window as any)?.SpeechRecognition || (window as any)?.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Dictation is not supported in this browser.");
      return;
    }
    if (isDictating) {
      stopDictation();
      return;
    }
    stopDictation();

    const recognition = new SpeechRecognition();
    recognitionRef.current = recognition;
    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0]?.transcript || "";
        }
      }
      const cleaned = transcript.trim();
      if (!cleaned) return;
      setDraft((prev) => {
        if (!prev) return prev;
        const spacer = prev.title && !prev.title.endsWith(" ") ? " " : "";
        return { ...prev, title: `${prev.title}${spacer}${cleaned}`.trimStart() };
      });
    };

    recognition.onend = () => {
      setIsDictating(false);
      recognitionRef.current = null;
    };
    recognition.onerror = () => {
      setIsDictating(false);
      recognitionRef.current = null;
    };

    setIsDictating(true);
    recognition.start();
  }

  useEffect(() => {
    if (!openTask) {
      setDraft(null);
      setPhotoViewer(null);
      stopDictation();
      return;
    }
    setDraft({ ...openTask, photos: openTask.photos ?? [] });
    setPhotoViewer(null);
    if (!openTask.id) {
      requestAnimationFrame(() => titleInputRef.current?.focus());
      setTimeout(() => titleInputRef.current?.focus(), 120);
    }
  }, [openTask]);
  useEffect(() => {
    if (!incomingPhotos.length) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const nextPhotos = [...(prev.photos ?? []), ...incomingPhotos];
      return { ...prev, photos: nextPhotos };
    });
    onConsumeIncomingPhotos();
    if (isMobile) {
      setTimeout(() => titleInputRef.current?.focus(), 120);
    }
  }, [incomingPhotos, onConsumeIncomingPhotos, isMobile]);
  if (!draft) return null;

  const derivedStatus = getDerivedStatus(draft);
  const hasDerivedStatus = !!derivedStatus;
  const hasStatusOverride = !!draft.statusOverride;
  const showAutoOption = hasDerivedStatus || hasStatusOverride;
  const manualStatusValue = MANUAL_STATUS_OPTIONS.includes(draft.status) ? draft.status : "";
  const statusSelectValue = hasStatusOverride
    ? draft.statusOverride!
    : hasDerivedStatus
      ? STATUS_AUTO_VALUE
      : manualStatusValue;
  const statusPlaceholder = manualStatusValue
    ? "Select status"
    : "Derived from dates";
  const autoStatusLabel = derivedStatus ? `${derivedStatus} (auto)` : "Auto";
  const phaseOptions = columns;
  const selectedPhaseId = draft.phaseId || draft.columnId || phaseOptions[0]?.id || "";
  const userOptions = users;
  const assignedUserId = draft.assignedUserId || "";
  const photos = draft.photos ?? [];
  const canSave = !!selectedPhaseId && draft.title.trim().length > 0;
  const usersPlaceholder = usersLoading
    ? "Loading users..."
    : userOptions.length
      ? "Select user"
      : "No users";
  const dictationSupported =
    typeof window !== "undefined" &&
    !!((window as any)?.SpeechRecognition || (window as any)?.webkitSpeechRecognition);

  function appendPhotos(next: PhotoAttachment[]) {
    if (!next.length) return;
    setDraft((prev) => {
      if (!prev) return prev;
      const existing = prev.photos ?? [];
      return { ...prev, photos: [...existing, ...next] };
    });
  }

  return (
    <Sheet open={!!openTask} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="w-full sm:max-w-lg bg-white overflow-y-auto [&>button]:hidden">
        <SheetHeader className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-neutral-200 pb-3">
          <div className="flex items-center justify-between gap-3">
            <SheetTitle>{draft.id ? "Edit Task" : "New Task"}</SheetTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="rounded-full"
                disabled={!canSave}
                onClick={() => {
                  onSave(draft);
                  onClose();
                }}
              >
                Save
              </Button>
              <Button size="sm" variant="secondary" className="rounded-full" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </div>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-medium">Title</label>
            <div className="mt-1 flex items-center gap-2">
              <Input
                ref={titleInputRef}
                autoFocus
                value={draft.title}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                placeholder="e.g., Call vendor / Order material"
                className="flex-1"
              />
              <Button
                type="button"
                size="icon"
                variant={isDictating ? "destructive" : "outline"}
                className="shrink-0"
                onClick={startTitleDictation}
                disabled={!dictationSupported}
                aria-pressed={isDictating}
                aria-label={isDictating ? "Stop dictation" : "Start dictation"}
                title={dictationSupported ? (isDictating ? "Stop dictation" : "Start dictation") : "Dictation not supported"}
              >
                <Mic className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div>
            <label className="text-xs font-medium">Phase</label>
            <Select
              value={selectedPhaseId}
              onValueChange={(value) => {
                setDraft({ ...draft, columnId: value, phaseId: value });
                onPhaseChange?.(value);
              }}
              disabled={!phaseOptions.length}
            >
              <SelectTrigger className="w-full bg-white">
                <SelectValue placeholder={phaseOptions.length ? "Select phase" : "No phases"} />
              </SelectTrigger>
              <SelectContent className="bg-white">
                {phaseOptions.map((phase) => (
                  <SelectItem key={phase.id} value={phase.id}>
                    {phase.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!phaseOptions.length && (
              <div className="text-xs text-neutral-500 mt-1">Create a phase before saving a task.</div>
            )}
          </div>

          <div>
            <label className="text-xs font-medium">Assigned To</label>
            <Select
              value={assignedUserId}
              onValueChange={(value) => {
                setDraft({ ...draft, assignedUserId: value });
                onAssignedChange?.(value);
              }}
              disabled={usersLoading || !userOptions.length}
            >
              <SelectTrigger className="w-full bg-white">
                <SelectValue placeholder={usersPlaceholder} />
              </SelectTrigger>
              <SelectContent className="bg-white">
                {userOptions.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-xs font-medium">Status</label>
            <Select
              value={statusSelectValue}
              onValueChange={(v) => {
                if (v === STATUS_AUTO_VALUE) {
                  setDraft({ ...draft, statusOverride: undefined });
                  return;
                }
                if (hasDerivedStatus || hasStatusOverride) {
                  setDraft({ ...draft, statusOverride: v as TaskStatus });
                  return;
                }
                setDraft({ ...draft, status: v as TaskStatus });
              }}
            >
              <SelectTrigger className="w-full bg-white">
                <SelectValue placeholder={statusPlaceholder} />
              </SelectTrigger>
              <SelectContent className="bg-white">
                {showAutoOption && (
                  <SelectItem value={STATUS_AUTO_VALUE}>
                    {autoStatusLabel}
                  </SelectItem>
                )}
                {MANUAL_STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasDerivedStatus || hasStatusOverride ? (
              draft.statusOverride ? (
                <div className="text-xs text-neutral-500 mt-1">
                  Manual override enabled.
                </div>
              ) : (
                <div className="text-xs text-neutral-500 mt-1">
                  Date-based status: {derivedStatus}.
                </div>
              )
            ) : !manualStatusValue ? (
              <div className="text-xs text-neutral-500 mt-1">
                Date-based status is derived from dates.
              </div>
            ) : null}
          </div>

          <div>
            <label className="text-xs font-medium">Percent Complete</label>
            <div className="mt-1">
              <Input
                type="number"
                min={0}
                max={100}
                step={1}
                value={typeof draft.percentComplete === "number" ? String(draft.percentComplete) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  const n = v === "" ? undefined : Math.max(0, Math.min(100, Math.round(Number(v))));
                  setDraft({ ...draft, percentComplete: n });
                }}
                placeholder="0-100"
                className="h-10 text-base sm:text-sm bg-white"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium">Dates</label>
            <div className="task-date-grid grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-600">Start Date</label>
                <Input
                  type="date"
                  value={toDateInputValue(draft.startDate)}
                  onChange={(e) => {
                    const nextStartDate = normalizeDateInput(e.target.value);
                    let nextEndDate = draft.endDate;
                    if (nextStartDate && typeof draft.workDays === "number") {
                      nextEndDate = computeEndDate(nextStartDate, draft.workDays) ?? nextEndDate;
                    }
                    setDraft({ ...draft, startDate: nextStartDate, endDate: nextEndDate });
                  }}
                  className="h-10 text-sm bg-white"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-neutral-600">End Date</label>
                <Input
                  type="date"
                  value={toDateInputValue(draft.endDate)}
                  onChange={(e) => {
                    const nextEndDate = normalizeDateInput(e.target.value);
                    setDraft({ ...draft, endDate: nextEndDate });
                  }}
                  className="h-10 text-sm bg-white"
                />
              </div>
              <div className="space-y-1 col-span-2 sm:col-span-1">
                <label className="text-xs font-medium text-neutral-600">Work Days</label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={typeof draft.workDays === "number" ? String(draft.workDays) : ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    const n = v === "" ? undefined : Math.max(0, Math.floor(Number(v)));
                    let nextEndDate = draft.endDate;
                    if (draft.startDate && typeof n === "number") {
                      nextEndDate = computeEndDate(draft.startDate, n) ?? nextEndDate;
                    }
                    setDraft({ ...draft, workDays: n, endDate: nextEndDate });
                  }}
                  placeholder="e.g., 3"
                  className="h-10 text-base sm:text-sm bg-white"
                />
              </div>
            </div>
          </div>
          <div>
            <label className="text-xs font-medium">Photos</label>
            {photos.length ? (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {photos.map((photo, index) => (
                  <div key={photo.id} className="relative">
                    <button
                      type="button"
                      className="block w-full overflow-hidden rounded-lg border border-neutral-200 bg-neutral-100"
                      onClick={() => setPhotoViewer({ photos, index })}
                      title="View photo"
                    >
                      <img
                        src={photo.uri}
                        alt="Task attachment"
                        className="h-24 w-full object-cover"
                        // Lazy decode to avoid upfront work when opening the editor.
                        loading="lazy"
                        decoding="async"
                      />
                    </button>
                    <button
                      type="button"
                      className="absolute top-1 right-1 rounded-full bg-black/70 p-1 text-white hover:bg-black/80"
                      onClick={() => {
                        setDraft((prev) => {
                          if (!prev) return prev;
                          return {
                            ...prev,
                            photos: (prev.photos ?? []).filter((p) => p.id !== photo.id),
                          };
                        });
                      }}
                      aria-label="Remove photo"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-neutral-500">No photos yet.</div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {isMobile && (
                <Button
                  type="button"
                  variant="secondary"
                  className="rounded-full"
                  onClick={() => onRequestCamera(appendPhotos)}
                >
                  <Camera className="h-4 w-4 mr-2" />
                  Add from camera
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                className="rounded-full"
                onClick={() => onRequestFiles(appendPhotos)}
              >
                <ImagePlus className="h-4 w-4 mr-2" />
                Add from files
              </Button>
            </div>
          </div>
        </div>
      </SheetContent>
      <TaskPhotoViewer
        open={!!photoViewer}
        photos={photoViewer?.photos}
        initialIndex={photoViewer?.index ?? 0}
        onClose={() => setPhotoViewer(null)}
      />
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
  const today = startOfDay(new Date());
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
    const items = tasks.filter((t) => getDisplayStatus(t, today) === section.key);
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
  const today = startOfDay(new Date());
  const UPCOMING: TaskStatus[] = ["This week", "Next week", "Week After"];
  const colName = (id: string) => columns.find(c => c.id === id)?.name || "Unknown";
  const completed = tasks.filter(t => getDisplayStatus(t, today) === "Completed");
  const inProcess = tasks.filter(t => getDisplayStatus(t, today) === "In Process");
  const upcoming = tasks.filter(t => UPCOMING.includes(getDisplayStatus(t, today)));

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
  const today = startOfDay(new Date());
  const byCol: Record<string, Record<TaskStatus, number>> = {};
  for (const c of columns) {
    byCol[c.id] = STATUS_OPTIONS.reduce((acc, s) => {
      acc[s] = 0;
      return acc;
    }, {} as Record<TaskStatus, number>);
  }
  for (const t of tasks) {
    const days = typeof t.workDays === "number" ? t.workDays : 0;
    const status = getDisplayStatus(t, today);
    if (!byCol[t.columnId]) {
      byCol[t.columnId] = STATUS_OPTIONS.reduce((acc, s) => {
        acc[s] = 0;
        return acc;
      }, {} as Record<TaskStatus, number>);
    }
    byCol[t.columnId][status] += days;
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
  const today = startOfDay(new Date());

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
            const items = tasks.filter((t) => getDisplayStatus(t, today) === section.key);
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
  const today = startOfDay(new Date());

  const UPCOMING: TaskStatus[] = ["This week", "Next week", "Week After"];
  const colName = (id: string) => columns.find(c => c.id === id)?.name || "Unknown";
  const completed = tasks.filter(t => getDisplayStatus(t, today) === "Completed");
  const inProcess = tasks.filter(t => getDisplayStatus(t, today) === "In Process");
  const upcoming = tasks.filter(t => UPCOMING.includes(getDisplayStatus(t, today)));

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
    const today = startOfDay(new Date());
    const byCol: Record<string, any> = {};
    for (const c of columns) byCol[c.id] = { column: c.name };
    for (const t of tasks) {
      const days = typeof t.workDays === "number" ? t.workDays : 0;
      const status = getDisplayStatus(t, today);
      if (!byCol[t.columnId]) byCol[t.columnId] = { column: "Unknown" };
      byCol[t.columnId][status] = (byCol[t.columnId][status] || 0) + days;
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
    boardLoading,
    boardError,
    isInitialBoardLoading,
    setBoard,
    saveTask,
    deleteTask,
    removeColumn,
    scheduleSaveBoard,
  } = useBoard(authUserId, currentProjectId);

  const [openTask, setOpenTask] = useState<Task | null>(null);
  const [openColumn, setOpenColumn] = useState<Column | null | undefined>(undefined);
  const [showReport, setShowReport] = useState(false);
  const [showOwner, setShowOwner] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [collapsedPhaseIds, setCollapsedPhaseIds] = useState<Set<string>>(() => new Set());

  const [photoViewer, setPhotoViewer] = useState<{ photos: PhotoAttachment[]; index: number } | null>(null);
  const [queuedPhotos, setQueuedPhotos] = useState<PhotoAttachment[]>([]);

  const [users, setUsers] = useState<UserOption[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [taskDefaults, setTaskDefaults] = useState<{ phaseId: string; assignedUserId: string }>({
    phaseId: "",
    assignedUserId: "",
  });


  // mobile: hamburger menu open
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);



  const isAuthed = !!authUserId;
  const todayStamp = startOfDay(new Date()).getTime();
  const today = new Date(todayStamp);
  // Memoize derived statuses/tone so list rendering doesn't recompute per render.
  const displayStatusById = useMemo(() => {
    const map = new Map<string, TaskStatus>();
    for (const t of tasks) {
      map.set(t.id, getDisplayStatus(t, today));
    }
    return map;
  }, [tasks, todayStamp]);
  const toneByTaskId = useMemo(() => {
    const map = new Map<string, ReturnType<typeof getStatusClasses>>();
    for (const [id, status] of displayStatusById.entries()) {
      map.set(id, getStatusClasses(status));
    }
    return map;
  }, [displayStatusById]);
  const tasksByColumnSorted = useMemo(
    () => groupTasksByColumn(tasks, columns, today, displayStatusById),
    [tasks, columns, todayStamp, displayStatusById]
  );
  const userLabelById = useMemo(
    () => new Map(users.map((u) => [u.id, u.label])),
    [users]
  );
  const sensors = useSensors(
    useSensor(MouseSensor),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handleEditTask = useCallback((task: Task) => {
    setQueuedPhotos([]);
    setOpenTask(task);
  }, []);
  const handleViewPhotos = useCallback((photos: PhotoAttachment[], index: number) => {
    setPhotoViewer({ photos, index });
  }, []);
  const handleDeleteTask = useCallback((id: string) => {
    deleteTask(id);
  }, [deleteTask]);
  const handleRenameTask = useCallback((task: Task) => {
    saveTask(task);
  }, [saveTask]);

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

  function handlePhaseDragEnd(event: any) {
    const { active, over } = event;
    if (!over) return;

    const activeId = String(active?.id || "");
    const overId = String(over?.id || "");
    if (!activeId.startsWith("col:") || !overId.startsWith("col:")) return;

    const fromColId = activeId.replace("col:", "");
    const toColId = overId.replace("col:", "");

    const oldIndex = columns.findIndex((c) => c.id === fromColId);
    const newIndex = columns.findIndex((c) => c.id === toColId);
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return;

    const nextCols = arrayMove(columns, oldIndex, newIndex);
    const next = { columns: nextCols, tasks };
    setBoard(next);
    scheduleSaveBoard(next.columns, next.tasks);
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
    if (!taskDefaults.phaseId && columns.length) {
      setTaskDefaults((prev) => ({ ...prev, phaseId: columns[0].id }));
      return;
    }
    if (taskDefaults.phaseId && columns.length && !columns.some((c) => c.id === taskDefaults.phaseId)) {
      setTaskDefaults((prev) => ({ ...prev, phaseId: columns[0].id }));
    }
  }, [columns, taskDefaults.phaseId]);

  useEffect(() => {
    if (authUserId && !taskDefaults.assignedUserId) {
      setTaskDefaults((prev) => ({ ...prev, assignedUserId: authUserId }));
    }
  }, [authUserId, taskDefaults.assignedUserId]);

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
  // Tasks are grouped + sorted locally for display

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
        photos: t.photos,
        percentComplete: t.percentComplete,
        statusOverride: t.statusOverride,
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
    const today = startOfDay(new Date());
    for (const t of tasks) {
      rows.push([
        colName(t.columnId),
        t.title,
        getDisplayStatus(t, today),
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
              photos: [],
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

  function readFilesAsAttachments(files: File[]): Promise<PhotoAttachment[]> {
    const work = files.map((file) => {
      const photoId = uuid();
      return new Promise<PhotoAttachment | null>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = String(reader.result || "");
          if (!dataUrl) {
            resolve(null);
            return;
          }
          resolve({ id: photoId, uri: dataUrl });
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
    });
    return Promise.all(work).then((results) => results.filter(Boolean) as PhotoAttachment[]);
  }

  function requestImageAttachments(options: {
    capture?: "environment";
    onComplete: (photos: PhotoAttachment[]) => void;
  }) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    if (options.capture) input.capture = options.capture;

    const handleChange = () => {
      const files = Array.from(input.files ?? []);
      input.remove();
      if (!files.length) return;
      readFilesAsAttachments(files).then((photos) => {
        if (photos.length) options.onComplete(photos);
      });
    };

    input.addEventListener("change", handleChange, { once: true });
    document.body.appendChild(input);
    input.click();
  }

  function buildNewTask(overridePhaseId?: string): Task {
    const phaseId = overridePhaseId || taskDefaults.phaseId || columns[0]?.id || "";
    const assignedUserId = taskDefaults.assignedUserId || authUserId || "";
    setTaskDefaults((prev) => ({ ...prev, phaseId, assignedUserId }));
    return {
      id: "",
      title: "",
      columnId: phaseId,
      phaseId,
      assignedUserId,
      startDate: undefined,
      endDate: undefined,
      status: "Unassigned",
      workDays: undefined,
      percentComplete: 0,
      statusOverride: undefined,
      photos: [],
      notes: undefined,
    };
  }

  function openCreateTask(overridePhaseId?: string) {
    setQueuedPhotos([]);
    setOpenTask(buildNewTask(overridePhaseId));
  }

  function handleAddTaskPhoto() {
    openCreateTask();
    requestImageAttachments({
      capture: "environment",
      onComplete: (photos) => {
        setQueuedPhotos(photos);
      },
    });
  }

  function handleAddTaskForPhase(phaseId: string) {
    openCreateTask(phaseId);
  }

  function handleReportSelect(value: string) {
    if (value === "threeWeek") setShowReport(true);
    else if (value === "ownerUpdate") setShowOwner(true);
    else if (value === "taskSummary") setShowSummary(true);
  }

  return (
    <div className="min-h-screen w-full max-w-[100vw] bg-white overflow-x-hidden">
      <CameraTaskButton
        onRequestPhoto={handleAddTaskPhoto}
        disabled={false}
      />
      <div
        className="w-full max-w-[100vw] mx-auto px-3 sm:px-6 pb-4 space-y-4 overflow-x-hidden"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 60px)" }}
      >
        <header
          className="relative z-10 bg-white pb-3 overflow-x-hidden"
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

                          {/* Loading indicator while phases + tasks are loading (non-blocking). */}
                          {boardLoading && (
                            <div className="flex items-center gap-2 text-xs opacity-60">
                              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                              <span>Loading board…</span>
                            </div>
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

                        {/* Loading indicator while phases + tasks are loading (non-blocking). */}
                        {boardLoading && (
                          <span className="inline-flex items-center gap-2 text-xs opacity-60 ml-2">
                            <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                            Loading board…
                          </span>
                        )}
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

        {isMobile && isInitialBoardLoading ? (
          <div className="text-sm opacity-60">Loading board…</div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handlePhaseDragEnd}
          >
            <SortableContext
              items={columns.map((c) => `col:${c.id}`)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-4 w-full">
                {columns.length === 0 ? (
                  <div className="text-sm opacity-60">No phases yet.</div>
                ) : (
                  columns.map((c) => {
                    const items = tasksByColumnSorted[c.id] || [];
                    return (
                      <div key={c.id} className="w-full">
                        <SortableColumn column={c}>
                          {({ setActivatorNodeRef, attributes, listeners }) => (
                            <div className="rounded-2xl border border-neutral-200 bg-neutral-50/70 p-3 sm:p-4 shadow-sm">
                              {/* Phase Header */}
                              <div className="flex items-center gap-2">
                                <div
                                  ref={setActivatorNodeRef}
                                  {...attributes}
                                  {...listeners}
                                  className="flex items-center gap-1 px-2 py-1 rounded-full border border-dashed border-neutral-300 text-[11px] uppercase tracking-wide text-neutral-500 cursor-grab active:cursor-grabbing select-none bg-white/70 flex-shrink-0"
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
                                  onClick={() => handleAddTaskForPhase(c.id)}
                                  title="Add Task"
                                  aria-label="Add Task"
                                >
                                  <Plus className="h-4 w-4" />
                                </Button>
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
                              </div>

                              {!isPhaseCollapsed(c.id) && (
                                <>
                                  <div className="mt-3 space-y-2">
                                    {items.map((t) => {
                                      const displayStatus = displayStatusById.get(t.id) ?? t.status;
                                      const tone = toneByTaskId.get(t.id) ?? DEFAULT_STATUS_TONE;
                                      return (
                                        <TaskCard
                                          key={t.id}
                                          task={t}
                                          displayStatus={displayStatus}
                                          tone={tone}
                                          onEdit={handleEditTask}
                                          onDelete={handleDeleteTask}
                                          onRename={handleRenameTask}
                                          onViewPhoto={handleViewPhotos}
                                          assignedLabel={userLabelById.get(t.assignedUserId)}
                                        />
                                      );
                                    })}
                                  </div>

                                  <div className="flex justify-end mt-3">
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
          </DndContext>
        )}
      </div>

      {showReport && <ThreeWeekReport tasks={tasks} columns={columns} onClose={() => setShowReport(false)} />}
      {showOwner && <OwnerUpdateReport tasks={tasks} columns={columns} onClose={() => setShowOwner(false)} />}
      {showSummary && <TaskSummaryChart tasks={tasks} columns={columns} onClose={() => setShowSummary(false)} />}

      <TaskPhotoViewer
        open={!!photoViewer}
        photos={photoViewer?.photos}
        initialIndex={photoViewer?.index ?? 0}
        onClose={() => setPhotoViewer(null)}
      />

      <TaskEditor
        openTask={openTask}
        onSave={saveTask}
        onClose={() => {
          setQueuedPhotos([]);
          setOpenTask(null);
        }}
        columns={columns}
        users={users}
        usersLoading={usersLoading}
        incomingPhotos={queuedPhotos}
        onConsumeIncomingPhotos={() => setQueuedPhotos([])}
        onRequestCamera={(onPhotos) => requestImageAttachments({ capture: "environment", onComplete: onPhotos })}
        onRequestFiles={(onPhotos) => requestImageAttachments({ onComplete: onPhotos })}
        onPhaseChange={(value) => setTaskDefaults((prev) => ({ ...prev, phaseId: value }))}
        onAssignedChange={(value) => setTaskDefaults((prev) => ({ ...prev, assignedUserId: value }))}
        isMobile={isMobile}
      />
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
