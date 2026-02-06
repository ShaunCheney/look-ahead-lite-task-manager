import React, { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Mic, MicOff, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PhotoAttachment } from "@/board/boardService";

export interface UserOption {
  id: string;
  label: string;
}

export interface PhaseOption {
  id: string;
  name: string;
}

type CameraTaskButtonProps = {
  onCapture: (file: File) => void;
  inputRef?: React.RefObject<HTMLInputElement>;
  disabled?: boolean;
};

export function CameraTaskButton({ onCapture, inputRef, disabled }: CameraTaskButtonProps) {
  const localRef = useRef<HTMLInputElement>(null);
  const fileRef = inputRef ?? localRef;

  return (
    <div className="fixed top-0 left-0 right-0 z-40 border-b border-neutral-200 bg-white/95 backdrop-blur">
      <div
        className="px-3 pb-2 pt-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 8px)" }}
      >
        <Button
          type="button"
          className="w-full h-11 text-base rounded-full bg-neutral-900 text-white hover:bg-neutral-800"
          onClick={() => fileRef.current?.click()}
          disabled={disabled}
        >
          <Camera className="h-4 w-4 mr-2" />
          Add Task (Photo)
        </Button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onCapture(file);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}

type VoiceInputProps = {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
};

export function VoiceInput({ label = "Task Description", value, onChange, placeholder }: VoiceInputProps) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const baseRef = useRef("");

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    setSupported(true);
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) final += res[0].transcript;
        else interim += res[0].transcript;
      }
      const combined = [baseRef.current, final, interim].filter(Boolean).join(" ");
      const next = combined.replace(/\s+/g, " ").trim();
      onChange(next);
      if (final) {
        baseRef.current = next;
      }
    };

    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);

    recognitionRef.current = recognition;
    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.stop();
      } catch {
        // no-op
      }
    };
  }, [onChange]);

  function toggleListening() {
    if (!supported) return;
    if (listening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        // no-op
      }
      setListening(false);
      return;
    }
    baseRef.current = value;
    try {
      recognitionRef.current?.start();
      setListening(true);
    } catch {
      // no-op
    }
  }

  return (
    <div className="space-y-2">
      <label className="text-sm font-semibold">{label}</label>
      <div className="flex items-start gap-2">
        <Textarea
          value={value}
          onChange={(e) => {
            const next = e.target.value;
            onChange(next);
            if (listening) baseRef.current = next;
          }}
          placeholder={placeholder || "Describe the task..."}
          rows={3}
          className="text-base"
        />
        <Button
          type="button"
          variant={listening ? "default" : "secondary"}
          className="h-12 w-12 rounded-full shrink-0"
          onClick={toggleListening}
          aria-pressed={listening}
          title={listening ? "Stop dictation" : "Start dictation"}
          disabled={!supported}
        >
          {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
        </Button>
      </div>
      {!supported && (
        <div className="text-xs text-neutral-500">
          Dictation isn't supported on this device.
        </div>
      )}
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

type DateRangePickerProps = {
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
};

export function DateRangePicker({ startDate, endDate, onStartDateChange, onEndDateChange }: DateRangePickerProps) {
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold">Dates</div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-600">Start Date</label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="h-12 text-base bg-white"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-600">End Date</label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="h-12 text-base bg-white"
          />
        </div>
      </div>
    </div>
  );
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
  onClose: () => void;
  onSave: (payload: {
    title: string;
    phaseId: string;
    assignedUserId: string;
    startDate?: string;
    endDate?: string;
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
  onClose,
  onSave,
  onRequestPhoto,
  onPhaseChange,
  onAssignedChange,
}: PhotoTaskModalProps) {
  const [title, setTitle] = useState("");
  const [phaseId, setPhaseId] = useState(defaultPhaseId || "");
  const [assignedUserId, setAssignedUserId] = useState(defaultAssignedUserId || "");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const wasOpenRef = useRef(false);

  const displayPhoto = photoPreviewUri || photo?.uri || "";
  const canSave = title.trim().length > 0 && !!photo && !photoProcessing && !!phaseId && !!assignedUserId;

  const phaseOptions = useMemo(() => phases, [phases]);

  function resetInputs() {
    setTitle("");
    setStartDate("");
    setEndDate("");
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

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <VoiceInput value={title} onChange={setTitle} />

        <div className="space-y-2">
          <label className="text-sm font-semibold">Phase</label>
          <Select value={phaseId} onValueChange={(val) => {
            setPhaseId(val);
            onPhaseChange?.(val);
          }}>
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

        <DateRangePicker
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
        />
      </div>

      <div
        className="sticky bottom-0 z-20 border-t border-neutral-200 bg-white p-4"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
      >
        <Button
          type="button"
          className="w-full h-12 text-base rounded-full bg-neutral-900 text-white hover:bg-neutral-800"
          onClick={() => {
            if (!photo) return;
            onSave({
              title: title.trim(),
              phaseId,
              assignedUserId,
              startDate: startDate || undefined,
              endDate: endDate || undefined,
              photo,
            });
            resetInputs();
            onRequestPhoto();
          }}
          disabled={!canSave}
        >
          Save Task
        </Button>
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
