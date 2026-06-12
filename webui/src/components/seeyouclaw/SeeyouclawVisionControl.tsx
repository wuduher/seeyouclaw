import { Camera, CameraOff, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SeeyouclawVisionController } from "@/hooks/seeyouclaw/useSeeyouclawVision";
import { cn } from "@/lib/utils";

export function SeeyouclawVisionPanel({
  vision,
}: {
  vision: SeeyouclawVisionController;
}) {
  if (!vision.enabled) {
    return <video ref={vision.videoRef} className="hidden" muted playsInline />;
  }

  return (
    <div className="flex items-center gap-2 px-3 pt-3">
      <div
        className={cn(
          "relative h-16 w-24 shrink-0 overflow-hidden rounded-md border border-border/65 bg-muted",
          "shadow-[0_3px_12px_rgba(15,23,42,0.08)]",
        )}
      >
        <video
          ref={vision.videoRef}
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
        />
        {(vision.cameraState === "starting" || vision.capturing) ? (
          <div className="absolute inset-0 flex items-center justify-center bg-background/55">
            <Loader2 className="h-4 w-4 animate-spin text-foreground/70" aria-hidden />
          </div>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        {vision.statusLabel ? (
          <div className="truncate text-[12px] font-medium text-foreground/75">
            {vision.statusLabel}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SeeyouclawVisionButton({
  disabled,
  isHero,
  vision,
}: {
  disabled?: boolean;
  isHero: boolean;
  vision: SeeyouclawVisionController;
}) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      disabled={disabled || vision.capturing}
      aria-label={vision.buttonLabel}
      onClick={vision.toggle}
      className={cn(
        "rounded-full border border-transparent text-muted-foreground hover:bg-muted/65 hover:text-foreground",
        isHero ? "h-8 w-8" : "h-9 w-9",
        vision.enabled &&
          "border-emerald-500/35 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/15 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200",
      )}
    >
      {vision.capturing ? (
        <Loader2 className={cn(isHero ? "h-4 w-4" : "h-4 w-4", "animate-spin")} />
      ) : vision.enabled ? (
        <CameraOff className={cn(isHero ? "h-4 w-4" : "h-4 w-4")} />
      ) : (
        <Camera className={cn(isHero ? "h-4 w-4" : "h-4 w-4")} />
      )}
    </Button>
  );
}
