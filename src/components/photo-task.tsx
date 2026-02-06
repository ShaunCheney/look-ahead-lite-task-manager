import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { PhotoAttachment, TaskStatus } from "@/board/boardService";

export interface UserOption {
  id: string;
  label: string;
}

export interface PhaseOption {
  id: string;
  name: string;
}

type CameraTaskButtonProps = {
  onRequestPhoto: () => void;
  disabled?: boolean;
};

export function CameraTaskButton({ onRequestPhoto, disabled }: CameraTaskButtonProps) {
  return (
    <div className="fixed top-0 left-0 right-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
      <div
        className="px-3 pb-2 pt-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)" }}
      >
        <Button
          type="button"
          className="w-full h-11 text-base rounded-full bg-neutral-900 text-white hover:bg-neutral-800"
          onClick={onRequestPhoto}
          disabled={disabled}
        >
          <Camera className="h-4 w-4 mr-2" />
          Add Task (Photo)
        </Button>
      </div>
    </div>
  );
}

type UserSelectDropdownProps = {
  users: UserOption[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  loading?: boolean;
};

export function UserSelectDropdown({ users, value, onChange, disabled, loading }: UserSelectDropdownProps) {
  const hasUsers = users.length > 0;
  const placeholder = loading ? "Loading users..." : hasUsers ? "Select user" : "No users";
  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold">Assigned To</label>
      <Select value={value} onValueChange={onChange} disabled={disabled || loading || !hasUsers}>
        <SelectTrigger className="h-12 text-base bg-white">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent className="bg-white">
          {users.map((user) => (
            <SelectItem key={user.id} value={user.id}>
              {user.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function toIsoDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function computeEndDate(startDateIso: string, workDays?: number): string | undefined {
  if (typeof workDays !== "number") return undefined;
  const start = parseDateInput(startDateIso);
  if (!start) return undefined;
  const safeDays = Math.max(0, Math.floor(workDays));
  if (safeDays <= 0) return toIsoDateString(start);
  const end = new Date(start);
  end.setDate(start.getDate() + safeDays - 1);
  return toIsoDateString(end);
}

type PhotoTaskModalProps = {
  open: boolean;
  photoPreviewUri?: string | null;
  photo?: PhotoAttachment | null;
  photoProcessing?: boolean;
  phases: PhaseOption[];
  users: UserOption[];
  usersLoading?: boolean;
  defaultPhaseId?: string;
  defaultAssignedUserId?: string;
  statusOptions: TaskStatus[];
  onClose: () => void;
  onSave: (payload: {
    title: string;
    phaseId: string;
    assignedUserId: string;
    status: TaskStatus;
    startDate?: string;
    endDate?: string;
    workDays?: number;
    photo: PhotoAttachment;
  }) => void;
  onRequestPhoto: () => void;
  onPhaseChange?: (value: string) => void;
  onAssignedChange?: (value: string) => void;
};

export function PhotoTaskModal({
  open,
  photoPreviewUri,
  photo,
  photoProcessing,
  phases,
  users,
  usersLoading,
  defaultPhaseId,
  defaultAssignedUserId,
  statusOptions,
  onClose,
  onSave,
  onRequestPhoto,
  onPhaseChange,
  onAssignedChange,
}: PhotoTaskModalProps) {
  const [title, setTitle] = useState("");
  const [phaseId, setPhaseId] = useState(defaultPhaseId || "");
  const [assignedUserId, setAssignedUserId] = useState(defaultAssignedUserId || "");
  const [status, setStatus] = useState<TaskStatus>("Unassigned");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [workDays, setWorkDays] = useState<number | undefined>(undefined);
  const wasOpenRef = useRef(false);

  const displayPhoto = photoPreviewUri || photo?.uri || "";
  const canSave = title.trim().length > 0 && !!photo && !photoProcessing && !!phaseId && !!assignedUserId;

  const phaseOptions = useMemo(() => phases, [phases]);

  function resetInputs() {
    setTitle("");
    setStartDate("");
    setEndDate("");
    setWorkDays(undefined);
    setStatus("Unassigned");
    setPhaseId(defaultPhaseId || phaseOptions[0]?.id || "");
    setAssignedUserId(defaultAssignedUserId || users[0]?.id || "");
  }

  useEffect(() => {
    if (open && !wasOpenRef.current) {
      resetInputs();
    }
    wasOpenRef.current = open;
  }, [open, defaultPhaseId, defaultAssignedUserId, phaseOptions, users]);

  useEffect(() => {
    if (!phaseId) {
      const next = defaultPhaseId || phaseOptions[0]?.id || "";
      if (next) {
        setPhaseId(next);
        onPhaseChange?.(next);
      }
    }
  }, [phaseId, defaultPhaseId, phaseOptions, onPhaseChange]);

  useEffect(() => {
    if (!assignedUserId) {
      const next = defaultAssignedUserId || users[0]?.id || "";
      if (next) {
        setAssignedUserId(next);
        onAssignedChange?.(next);
      }
    }
  }, [assignedUserId, defaultAssignedUserId, users, onAssignedChange]);

  useEffect(() => {
    if (!open) return;
    const bodyOverflow = document.body.style.overflow;
    const htmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = htmlOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      <div
        className="sticky top-0 z-20 bg-white border-b border-neutral-200 px-4 pb-3"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <div className="flex items-center justify-between gap-2 pt-2">
          <div className="text-base font-semibold">Photo Task Capture</div>
          <Button
            type="button"
            variant="ghost"
            className="h-9 w-9 p-0"
            onClick={onClose}
            aria-label="Close photo task modal"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="mt-3 space-y-2">
          <div className="rounded-xl overflow-hidden border border-neutral-200 bg-neutral-100">
            {displayPhoto ? (
              <img
                src={displayPhoto}
                alt="Captured task"
                className="w-full max-h-[35vh] object-contain bg-black/90"
              />
            ) : (
              <div className="h-[22vh] flex items-center justify-center text-sm text-neutral-500">
                Capture a photo to start.
              </div>
            )}
          </div>
          {photoProcessing && (
            <div className="text-xs text-neutral-500">Processing photo...</div>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              className="rounded-full"
              onClick={onRequestPhoto}
            >
              <RotateCw className="h-4 w-4 mr-2" />
              Retake Photo
            </Button>
          </div>
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
        style={{ WebkitOverflowScrolling: "touch" }}
      >
        <div className="space-y-2">
          <label className="text-sm font-semibold">Title</label>
          <Input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Call vendor / Order material"
            className="h-12 text-base bg-white"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold">Phase</label>
          <Select
            value={phaseId}
            onValueChange={(val) => {
              setPhaseId(val);
              onPhaseChange?.(val);
            }}
            disabled={!phaseOptions.length}
          >
            <SelectTrigger className="h-12 text-base bg-white">
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
            <div className="text-xs text-neutral-500">Create a phase before saving a task.</div>
          )}
        </div>

        <UserSelectDropdown
          users={users}
          value={assignedUserId}
          onChange={(val) => {
            setAssignedUserId(val);
            onAssignedChange?.(val);
          }}
          loading={usersLoading}
        />

        <div className="space-y-2">
          <label className="text-sm font-semibold">Status</label>
          <Select
            value={status}
            onValueChange={(val) => setStatus(val as TaskStatus)}
          >
            <SelectTrigger className="h-12 text-base bg-white">
              <SelectValue placeholder="Select status" />
            </SelectTrigger>
            <SelectContent className="bg-white">
              {statusOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-semibold">Dates</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-neutral-600">Start Date</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => {
                  const nextStartDate = e.target.value;
                  let nextEndDate = endDate;
                  if (nextStartDate && typeof workDays === "number") {
                    nextEndDate = computeEndDate(nextStartDate, workDays) ?? nextEndDate;
                  }
                  setStartDate(nextStartDate);
                  setEndDate(nextEndDate);
                }}
                className="h-12 text-base bg-white"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-neutral-600">End Date</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="h-12 text-base bg-white"
              />
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold">Work days</label>
          <Input
            type="number"
            min={0}
            step={1}
            value={typeof workDays === "number" ? String(workDays) : ""}
            onChange={(e) => {
              const v = e.target.value;
              const n = v === "" ? undefined : Math.max(0, Math.floor(Number(v)));
              let nextEndDate = endDate;
              if (startDate && typeof n === "number") {
                nextEndDate = computeEndDate(startDate, n) ?? nextEndDate;
              }
              setWorkDays(n);
              setEndDate(nextEndDate);
            }}
            placeholder="e.g., 3"
            className="h-12 text-base bg-white"
          />
        </div>
      </div>

      <div
        className="sticky bottom-0 z-20 border-t border-neutral-200 bg-white p-4"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <Button
            type="button"
            className="w-full h-12 text-base rounded-full bg-neutral-900 text-white hover:bg-neutral-800"
            onClick={() => {
              if (!photo) return;
              onSave({
                title: title.trim(),
                phaseId,
                assignedUserId,
                status,
                startDate: startDate || undefined,
                endDate: endDate || undefined,
                workDays,
                photo,
              });
              resetInputs();
              onClose();
            }}
            disabled={!canSave}
          >
            Save Task
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="w-full h-12 text-base rounded-full"
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

type TaskPhotoViewerProps = {
  open: boolean;
  photo?: PhotoAttachment | null;
  onClose: () => void;
};

export function TaskPhotoViewer({ open, photo, onClose }: TaskPhotoViewerProps) {
  if (!open || !photo) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div className="text-sm font-semibold">Task Photo</div>
        <Button
          type="button"
          variant="ghost"
          className="text-white hover:bg-white/10"
          onClick={onClose}
        >
          Close
        </Button>
      </div>
      <div
        className="flex-1 overflow-auto"
        style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}
      >
        <img
          src={photo.uri}
          alt="Task attachment"
          className="w-full h-auto object-contain"
        />
      </div>
    </div>
  );
}
