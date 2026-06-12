import { useCallback, useEffect, useRef, useState } from "react";

export type CameraSnapshotState = "idle" | "starting" | "ready" | "error";

export interface CameraSnapshot {
  bytes: number;
  dataUrl: string;
  height: number;
  name: string;
  width: number;
}

interface CaptureOptions {
  maxWidth?: number;
  quality?: number;
}

const DEFAULT_MAX_WIDTH = 960;
const DEFAULT_QUALITY = 0.72;

function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.split(",", 2)[1] ?? "";
  return Math.floor((b64.length * 3) / 4);
}

function snapshotName(): string {
  return `seeyouclaw-camera-${new Date().toISOString().replace(/[:.]/g, "-")}.jpg`;
}

async function waitForVideoReady(video: HTMLVideoElement): Promise<void> {
  if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("camera video timed out"));
    }, 1800);

    function cleanup(): void {
      window.clearTimeout(timeout);
      video.removeEventListener("loadedmetadata", onReady);
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onError);
    }

    function onReady(): void {
      if (video.videoWidth <= 0) return;
      cleanup();
      resolve();
    }

    function onError(): void {
      cleanup();
      reject(new Error("camera video failed"));
    }

    video.addEventListener("loadedmetadata", onReady);
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", onError);
  });
}

export function useCameraSnapshot() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const startPromiseRef = useRef<Promise<void> | null>(null);
  const generationRef = useRef(0);
  const [state, setState] = useState<CameraSnapshotState>("idle");
  const [error, setError] = useState<string | null>(null);

  const stop = useCallback(() => {
    generationRef.current += 1;
    startPromiseRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
    }
    setState("idle");
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current) return;
    if (startPromiseRef.current) return startPromiseRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setState("error");
      setError("camera unsupported");
      return;
    }

    const generation = generationRef.current;
    const promise = (async () => {
      setState("starting");
      setError(null);
      let stream: MediaStream | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: "user",
          },
        });
        if (generation !== generationRef.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.muted = true;
          videoRef.current.playsInline = true;
          await videoRef.current.play();
        }
        setState("ready");
      } catch {
        stream?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setState("error");
        setError("camera permission denied");
      }
    })();
    startPromiseRef.current = promise;
    try {
      await promise;
    } finally {
      if (startPromiseRef.current === promise) {
        startPromiseRef.current = null;
      }
    }
  }, []);

  const capture = useCallback(async (options: CaptureOptions = {}): Promise<CameraSnapshot> => {
    if (!streamRef.current) {
      await start();
    }
    const video = videoRef.current;
    if (!video || !streamRef.current) {
      throw new Error("camera unavailable");
    }

    await waitForVideoReady(video);

    const rawWidth = Math.max(1, video.videoWidth);
    const rawHeight = Math.max(1, video.videoHeight);
    const maxWidth = options.maxWidth ?? DEFAULT_MAX_WIDTH;
    const scale = Math.min(1, maxWidth / rawWidth);
    const width = Math.max(1, Math.round(rawWidth * scale));
    const height = Math.max(1, Math.round(rawHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas unavailable");
    ctx.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", options.quality ?? DEFAULT_QUALITY);

    return {
      bytes: dataUrlBytes(dataUrl),
      dataUrl,
      height,
      name: snapshotName(),
      width,
    };
  }, [start]);

  useEffect(() => stop, [stop]);

  return {
    capture,
    error,
    start,
    state,
    stop,
    videoRef,
  };
}
