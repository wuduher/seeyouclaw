import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_IMAGES_PER_MESSAGE } from "@/hooks/useAttachedImages";
import { useCameraSnapshot } from "@/hooks/seeyouclaw/useCameraSnapshot";
import type { SendImage } from "@/hooks/useNanobotStream";
import {
  decideVisionRoute,
  formatVisionRoute,
} from "@/lib/seeyouclaw/visionRouter";

const VISION_CAPTURE_COOLDOWN_MS = 2_500;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

interface UseSeeyouclawVisionOptions {
  labels?: Partial<{
    audioOnlyCameraUnavailable: string;
    cameraReady: string;
    cameraStarting: string;
    cameraUnavailable: string;
    turnCameraOff: string;
    turnCameraOn: string;
  }>;
  onCaptureError?: () => void;
  onToggle?: () => void;
}

const DEFAULT_LABELS = {
  audioOnlyCameraUnavailable: "Audio only: camera unavailable",
  cameraReady: "Camera ready",
  cameraStarting: "Camera starting",
  cameraUnavailable: "Camera unavailable",
  turnCameraOff: "Turn camera off",
  turnCameraOn: "Turn camera on",
};

export function useSeeyouclawVision({
  labels: labelOverrides,
  onCaptureError,
  onToggle,
}: UseSeeyouclawVisionOptions = {}) {
  const camera = useCameraSnapshot();
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const [enabled, setEnabled] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [lastRoute, setLastRoute] = useState<string | null>(null);
  const cooldownUntilRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      camera.stop();
      return;
    }
    void camera.start();
  }, [camera.start, camera.stop, enabled]);

  const toggle = useCallback(() => {
    setEnabled((current) => !current);
    setLastRoute(null);
    onToggle?.();
  }, [onToggle]);

  const prepareAttachment = useCallback(async (
    text: string,
    attachedImageCount: number,
  ): Promise<SendImage | undefined> => {
    const decision = decideVisionRoute(text, {
      attachedImageCount,
      cameraEnabled: enabled,
      cooldownActive: Date.now() < cooldownUntilRef.current,
      maxImagesPerTurn: MAX_IMAGES_PER_MESSAGE,
    });

    if (!decision.shouldCapture) {
      if (decision.trigger !== "no_visual_need") {
        setLastRoute(formatVisionRoute(decision));
      }
      return undefined;
    }

    setCapturing(true);
    try {
      const snapshot = await camera.capture();
      cooldownUntilRef.current = Date.now() + VISION_CAPTURE_COOLDOWN_MS;
      setLastRoute(`${formatVisionRoute(decision)} - ${formatBytes(snapshot.bytes)}`);
      return {
        media: {
          data_url: snapshot.dataUrl,
          name: snapshot.name,
        },
        preview: {
          url: snapshot.dataUrl,
          name: snapshot.name,
        },
      };
    } catch {
      setLastRoute(labels.audioOnlyCameraUnavailable);
      onCaptureError?.();
      return undefined;
    } finally {
      setCapturing(false);
    }
  }, [camera.capture, enabled, labels.audioOnlyCameraUnavailable, onCaptureError]);

  const statusLabel = camera.error
    ? labels.cameraUnavailable
    : camera.state === "starting"
      ? labels.cameraStarting
      : lastRoute ?? (enabled ? labels.cameraReady : null);

  return {
    buttonLabel: enabled ? labels.turnCameraOff : labels.turnCameraOn,
    cameraError: camera.error,
    cameraState: camera.state,
    capturing,
    enabled,
    prepareAttachment,
    statusLabel,
    toggle,
    videoRef: camera.videoRef,
  };
}

export type SeeyouclawVisionController = ReturnType<typeof useSeeyouclawVision>;
