/**
 * Queue-event notifications.
 *
 * GeForce NOW queues can run for many minutes; visitors switch tabs and miss
 * their slot. This module plays a short two-tone chime (generated with the
 * WebAudio API, no asset fetch) and raises a system notification when the tab
 * is hidden. System notifications require permission, which callers should
 * request from the Play button click so the browser counts it as a user
 * gesture.
 */

let audioContext: AudioContext | null = null;

export function isNotificationSupported(): boolean {
  return typeof Notification !== "undefined";
}

export async function ensureNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isNotificationSupported()) {
    return "unsupported";
  }
  if (Notification.permission === "default") {
    try {
      return await Notification.requestPermission();
    } catch {
      return Notification.permission;
    }
  }
  return Notification.permission;
}

/** Rising two-tone chime; silent no-op when audio is unavailable or blocked. */
export function playReadyChime(): void {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audioContext ??= new Ctor();
    if (audioContext.state === "suspended") {
      void audioContext.resume();
    }
    const context = audioContext;
    const now = context.currentTime;
    const tones: ReadonlyArray<readonly [frequency: number, offsetSeconds: number]> = [
      [880, 0],
      [1318.5, 0.18],
    ];
    for (const [frequency, offset] of tones) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now + offset);
      gain.gain.exponentialRampToValueAtTime(0.22, now + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.5);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(now + offset);
      oscillator.stop(now + offset + 0.55);
    }
  } catch {
    // Autoplay policy or unsupported environment: notifications still work.
  }
}

function showNotification(title: string, body: string, tag: string): void {
  if (!isNotificationSupported() || Notification.permission !== "granted") {
    return;
  }
  // Only pull attention away from another tab; in-tab the chime and UI suffice.
  if (typeof document !== "undefined" && document.visibilityState === "visible") {
    return;
  }
  try {
    const notification = new Notification(title, {
      body,
      icon: "/pwa-192.png",
      tag,
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // Window focus is best-effort.
      }
      notification.close();
    };
  } catch {
    // Some platforms require a service worker for notifications; skip quietly.
  }
}

export function notifyStreamReady(title: string, body: string): void {
  playReadyChime();
  showNotification(title, body, "opennow-stream-ready");
}

export function notifyQueueFailed(title: string, body: string): void {
  showNotification(title, body, "opennow-queue-failed");
}
