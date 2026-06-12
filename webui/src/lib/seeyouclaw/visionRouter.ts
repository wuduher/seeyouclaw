export type VisionRouteLevel = "audio_only" | "vision_snapshot" | "vision_burst";

export type VisionRouteTrigger =
  | "camera_disabled"
  | "cooldown"
  | "emotion_shift"
  | "explicit_visual_reference"
  | "image_limit"
  | "implicit_deixis"
  | "manual_attachment"
  | "no_visual_need"
  | "screen_or_ocr";

export interface VisionRouteOptions {
  cameraEnabled: boolean;
  attachedImageCount: number;
  maxImagesPerTurn: number;
  cooldownActive?: boolean;
}

export interface VisionRouteDecision {
  level: VisionRouteLevel;
  shouldCapture: boolean;
  trigger: VisionRouteTrigger;
  reason: string;
}

const EXPLICIT_VISUAL_PATTERNS: RegExp[] = [
  /(^|\s)(look|see|watch|inspect|check|show)\b/i,
  /\b(camera|webcam|photo|picture|image|video|visible)\b/i,
  /看看|看一下|看下|你看|拍一下|摄像头|镜头|画面|图片|照片|视频|视觉|观察/,
];

const SCREEN_OR_OCR_PATTERNS: RegExp[] = [
  /\b(screen|display|monitor|error|ocr|text on|read this)\b/i,
  /屏幕|显示器|报错|错误信息|代码|读一下|识别文字|这段文字|这个字/,
];

const IMPLICIT_DEIXIS_PATTERNS: RegExp[] = [
  /\b(this|that|here|there|these|those|it)\b/i,
  /这个|那个|这里|那里|这边|那边|这样|这是什么|它是什么|手里|桌上/,
];

const EMOTION_SHIFT_PATTERNS: RegExp[] = [
  /\b(panic|scared|afraid|anxious|urgent|help me|stuck|confused)\b/i,
  /崩溃|急死|害怕|慌|焦虑|不行了|救命|卡住了|看不懂|怎么办/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

export function decideVisionRoute(
  rawText: string,
  options: VisionRouteOptions,
): VisionRouteDecision {
  const text = rawText.trim();

  if (options.attachedImageCount >= options.maxImagesPerTurn) {
    return {
      level: "audio_only",
      shouldCapture: false,
      trigger: "image_limit",
      reason: "image limit reached",
    };
  }

  let wanted: VisionRouteDecision | null = null;
  if (matchesAny(text, SCREEN_OR_OCR_PATTERNS)) {
    wanted = {
      level: "vision_snapshot",
      shouldCapture: true,
      trigger: "screen_or_ocr",
      reason: "screen or OCR request",
    };
  } else if (matchesAny(text, EXPLICIT_VISUAL_PATTERNS)) {
    wanted = {
      level: "vision_snapshot",
      shouldCapture: true,
      trigger: "explicit_visual_reference",
      reason: "explicit visual request",
    };
  } else if (matchesAny(text, EMOTION_SHIFT_PATTERNS)) {
    wanted = {
      level: "vision_snapshot",
      shouldCapture: true,
      trigger: "emotion_shift",
      reason: "emotion or stress cue",
    };
  } else if (matchesAny(text, IMPLICIT_DEIXIS_PATTERNS)) {
    wanted = {
      level: "vision_snapshot",
      shouldCapture: true,
      trigger: "implicit_deixis",
      reason: "implicit visual reference",
    };
  }

  if (wanted && !options.cameraEnabled) {
    return {
      level: "audio_only",
      shouldCapture: false,
      trigger: "camera_disabled",
      reason: "camera is off",
    };
  }

  if (wanted && options.cooldownActive) {
    return {
      level: "audio_only",
      shouldCapture: false,
      trigger: "cooldown",
      reason: "camera capture cooldown",
    };
  }

  if (wanted) return wanted;

  if (options.attachedImageCount > 0) {
    return {
      level: "audio_only",
      shouldCapture: false,
      trigger: "manual_attachment",
      reason: "manual image already attached",
    };
  }

  return {
    level: "audio_only",
    shouldCapture: false,
    trigger: "no_visual_need",
    reason: "no visual trigger",
  };
}

export function formatVisionRoute(decision: VisionRouteDecision): string {
  switch (decision.trigger) {
    case "screen_or_ocr":
      return "Vision snapshot: screen/OCR";
    case "explicit_visual_reference":
      return "Vision snapshot: visual request";
    case "implicit_deixis":
      return "Vision snapshot: implicit reference";
    case "emotion_shift":
      return "Vision snapshot: stress cue";
    case "camera_disabled":
      return "Audio only: camera off";
    case "cooldown":
      return "Audio only: cooldown";
    case "image_limit":
      return "Audio only: image limit";
    case "manual_attachment":
      return "Audio only: image attached";
    case "no_visual_need":
    default:
      return "Audio only";
  }
}

