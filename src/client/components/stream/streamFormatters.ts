import { formatElapsed } from "../../utils/timeFormat";

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatWarningSeconds(value: number | undefined): string | null {
  if (value === undefined || !Number.isFinite(value) || value < 0) {
    return null;
  }
  const total = Math.floor(value);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  // Unit suffixes are Japanese: this string is printed next to the session
  // warning ("残り 2分 30秒"), not in a log.
  if (minutes > 0) {
    return `${minutes}分 ${seconds.toString().padStart(2, "0")}秒`;
  }
  return `${seconds}秒`;
}

export function formatSessionTimeRemaining(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return formatElapsed(value);
}
