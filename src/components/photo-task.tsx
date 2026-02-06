import { useEffect, useRef } from "react";
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
  photos?: PhotoAttachment[];
  initialIndex?: number;
  onClose: () => void;
};

export function TaskPhotoViewer({ open, photos = [], initialIndex = 0, onClose }: TaskPhotoViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const safeIndex = Math.min(Math.max(initialIndex, 0), Math.max(photos.length - 1, 0));

  useEffect(() => {
    if (!open || !containerRef.current) return;
    const el = containerRef.current;
    const scrollToIndex = () => {
      const width = el.clientWidth;
      if (width > 0) {
        el.scrollTo({ left: width * safeIndex, behavior: "auto" });
      }
    };
    requestAnimationFrame(scrollToIndex);
  }, [open, safeIndex, photos.length]);

  if (!open || !photos.length) return null;

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
      <div className="flex-1 overflow-hidden">
        <div
          ref={containerRef}
          className="flex h-full w-full overflow-x-auto overflow-y-hidden snap-x snap-mandatory"
          style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-x pan-y" }}
        >
          {photos.map((photo) => (
            <div
              key={photo.id}
              className="flex h-full w-full flex-shrink-0 snap-center items-center justify-center"
            >
              <img
                src={photo.uri}
                alt="Task attachment"
                className="w-full h-auto object-contain"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
