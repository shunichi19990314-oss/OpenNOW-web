/**
 * Stream frame capture for the AI player.
 *
 * Why this exists: without seeing the screen the model only knows "game, time,
 * allowed actions", so it converges on one safe action and repeats it forever
 * (the reported behaviour). A downscaled JPEG every round is enough to break
 * that loop and is the cheapest form of vision available.
 *
 * Kept out of React and injected with the video element, so the size maths and
 * the limits are testable without a browser.
 */
import {
  AI_PLAYER_FRAME_JPEG_QUALITY,
  AI_PLAYER_FRAME_MAX_BYTES,
  AI_PLAYER_FRAME_MAX_HEIGHT,
  AI_PLAYER_FRAME_MAX_WIDTH,
  type AiPlayerFrame,
} from "../../shared/aiPlayer";

export interface FrameSourceSize {
  width: number;
  height: number;
}

/**
 * Scales a video frame down to fit the capture bounds, preserving aspect ratio.
 *
 * Returns `null` for an empty source (video not ready), which the caller treats
 * as "this round has no image" rather than sending a black rectangle.
 */
export function computeFrameSize(source: FrameSourceSize): { width: number; height: number } | null {
  const { width, height } = source;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const scale = Math.min(
    1,
    AI_PLAYER_FRAME_MAX_WIDTH / width,
    AI_PLAYER_FRAME_MAX_HEIGHT / height,
  );
  return {
    // Even numbers keep the JPEG encoder happy and avoid half-pixel blur.
    width: Math.max(2, Math.round((width * scale) / 2) * 2),
    height: Math.max(2, Math.round((height * scale) / 2) * 2),
  };
}

/** True when the data URL is small enough to send. */
export function isFrameWithinLimit(dataUrl: string): boolean {
  return dataUrl.length > 0 && dataUrl.length <= AI_PLAYER_FRAME_MAX_BYTES;
}

/** Rough token estimate, shown in the panel so cost is not a surprise. */
export function estimateFrameTokens(frame: Pick<AiPlayerFrame, "width" | "height">): number {
  // ~1 token per 750 px is the widely used approximation for image inputs.
  return Math.max(85, Math.round((frame.width * frame.height) / 750));
}

export interface CaptureOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
}

/**
 * Captures the current video frame as a JPEG data URL.
 *
 * The canvas is created per capture and released immediately: a persistent
 * hidden canvas would keep a GPU-backed surface alive for the whole session,
 * which competes with the decoded video for memory on low-end machines.
 */
export function captureFrameFromVideo(
  video: HTMLVideoElement,
  options: CaptureOptions = {},
): AiPlayerFrame | null {
  const size = computeFrameSize({ width: video.videoWidth, height: video.videoHeight });
  if (!size) return null;

  const maxWidth = options.maxWidth ?? AI_PLAYER_FRAME_MAX_WIDTH;
  const maxHeight = options.maxHeight ?? AI_PLAYER_FRAME_MAX_HEIGHT;
  const scale = Math.min(1, maxWidth / size.width, maxHeight / size.height);
  const width = Math.max(2, Math.round((size.width * scale) / 2) * 2);
  const height = Math.max(2, Math.round((size.height * scale) / 2) * 2);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return null;
  try {
    context.drawImage(video, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", options.quality ?? AI_PLAYER_FRAME_JPEG_QUALITY);
    if (!isFrameWithinLimit(dataUrl)) return null;
    return { dataUrl, width, height };
  } catch {
    // A tainted canvas (cross-origin video without CORS) throws here. The loop
    // then runs blind rather than failing outright.
    return null;
  }
}
