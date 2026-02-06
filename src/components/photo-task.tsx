import { Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PhotoAttachment } from "@/board/boardService";

export interface UserOption {
  id: string;
  label: string;
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
