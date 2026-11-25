type TranslateFunction = typeof import("../i18n").t;

export function formatCatalogLastPlayed(t: TranslateFunction, date?: string): string {
  if (!date) return t("library.lastPlayed.never");

  const lastPlayed = new Date(date);
  const now = new Date();
  const diffMs = now.getTime() - lastPlayed.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return t("library.lastPlayed.justNow");
  if (diffMins < 60) return t("library.lastPlayed.minutesAgo", { count: diffMins });
  if (diffHours < 24) return t("library.lastPlayed.hoursAgo", { count: diffHours });
  if (diffDays < 7) return t("library.lastPlayed.daysAgo", { count: diffDays });
  if (diffDays < 30) return t("library.lastPlayed.weeksAgo", { count: Math.floor(diffDays / 7) });

  // `toLocaleDateString()` follows the browser language, which is not
  // necessarily the UI language (the app is Japanese-first but ignores the
  // browser locale on purpose).
  return lastPlayed.toLocaleDateString("ja-JP");
}
