import { useCallback, useEffect, useRef, useState } from "react";

import { MAX_IMAGES_PER_MESSAGE } from "@/hooks/useAttachedImages";
import { useCameraSnapshot } from "@/hooks/seeyouclaw/useCameraSnapshot";
import type { SendImage } from "@/hooks/useNanobotStream";
import {
  decideVisionRoute,
  formatVisionRoute,
  VISION_CONTEXT_TTL_MS,
  type SeeyouclawVisionRouteRequest,
  type SeeyouclawVisionRouteResponse,
  type VisionRouteContext,
  type VisionRouteContextKind,
  type VisionRouteDecision,
  type VisionRouteLevel,
  type VisionRouteTrigger,
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
  onRouteVisionIntent?: (
    payload: SeeyouclawVisionRouteRequest,
  ) => Promise<SeeyouclawVisionRouteResponse>;
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

function normalizeRouteLevel(level: string | undefined): VisionRouteLevel {
  if (level === "vision_burst") return "vision_burst";
  if (level === "vision_snapshot") return "vision_snapshot";
  return "audio_only";
}

function normalizeContextKind(kind: string | null | undefined): VisionRouteContextKind {
  if (kind === "appearance" || kind === "emotion" || kind === "screen") return kind;
  return "scene";
}

function triggerForRemoteDecision(
  response: SeeyouclawVisionRouteResponse,
): VisionRouteTrigger {
  const intent = (response.intent ?? "").toLowerCase();
  if (intent.includes("context")) return "contextual_followup";
  if (intent.includes("emotion") || response.emotionEscalation === "high") return "emotion_shift";
  return "llm_router";
}

function decisionFromRemoteRoute(
  response: SeeyouclawVisionRouteResponse,
  nowMs: number,
): VisionRouteDecision | null {
  if (!response.ok || !response.needVision) return null;
  const level = normalizeRouteLevel(response.route);
  if (level === "audio_only") return null;
  const slot = response.slot ?? {};
  const kind = normalizeContextKind(slot.kind);
  const trigger = triggerForRemoteDecision(response);
  const nextContext: VisionRouteContext = {
    expiresAtMs: nowMs + VISION_CONTEXT_TTL_MS,
    kind,
    lastTrigger: trigger,
    ...(slot.attribute ? { attribute: slot.attribute } : {}),
    ...(response.confidence !== undefined ? { confidence: response.confidence } : {}),
    ...(slot.questionType ? { questionType: slot.questionType } : {}),
    ...(slot.subject ? { subject: slot.subject } : {}),
  };
  return {
    bypassCooldown: response.bypassCooldown,
    level,
    nextContext,
    reason: response.reason?.trim() || "LLM vision route",
    shouldCapture: true,
    trigger,
  };
}

function remoteRouteFailureDecision(
  current: VisionRouteDecision,
  response: SeeyouclawVisionRouteResponse,
): VisionRouteDecision {
  const reason = response.reason?.trim() || "returned audio only";
  return {
    ...current,
    reason: `remote vision router: ${reason}`,
  };
}

export function useSeeyouclawVision({
  labels: labelOverrides,
  onCaptureError,
  onRouteVisionIntent,
  onToggle,
}: UseSeeyouclawVisionOptions = {}) {
  const camera = useCameraSnapshot();
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const [enabled, setEnabled] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [lastRoute, setLastRoute] = useState<string | null>(null);
  const cooldownUntilRef = useRef(0);
  const routeContextRef = useRef<VisionRouteContext | null>(null);

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
    routeContextRef.current = null;
    onToggle?.();
  }, [onToggle]);

  const prepareAttachment = useCallback(async (
    text: string,
    attachedImageCount: number,
  ): Promise<SendImage | undefined> => {
    const cooldownActive = Date.now() < cooldownUntilRef.current;
    let decision = decideVisionRoute(text, {
      attachedImageCount,
      cameraEnabled: enabled,
      context: routeContextRef.current,
      cooldownActive,
      maxImagesPerTurn: MAX_IMAGES_PER_MESSAGE,
    });

    if (
      decision.trigger === "no_visual_need"
      && enabled
      && !cooldownActive
      && attachedImageCount < MAX_IMAGES_PER_MESSAGE
      && text.trim()
      && onRouteVisionIntent
    ) {
      try {
        const response = await onRouteVisionIntent({
          attachedImageCount,
          cameraEnabled: enabled,
          context: decision.nextContext,
          cooldownActive,
          maxImagesPerTurn: MAX_IMAGES_PER_MESSAGE,
          text,
        });
        decision = decisionFromRemoteRoute(response, Date.now())
          ?? remoteRouteFailureDecision(decision, response);
      } catch {
        decision = {
          ...decision,
          reason: "remote vision router unavailable",
        };
      }
    }
    routeContextRef.current = decision.nextContext;

    if (!decision.shouldCapture) {
      if (
        decision.trigger !== "no_visual_need"
        || decision.reason.includes("remote vision router")
      ) {
        setLastRoute(`${formatVisionRoute(decision)} - ${decision.reason}`);
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
  }, [
    camera.capture,
    enabled,
    labels.audioOnlyCameraUnavailable,
    onCaptureError,
    onRouteVisionIntent,
  ]);

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
