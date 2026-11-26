import { CheckCircle2, KeyRound, ShieldAlert, Sparkles } from "lucide-react";
import { useEffect, useState, type JSX } from "react";

import { useTranslation } from "../../../i18n";
import type { AiPlayerStatus } from "../../../../shared/aiPlayer";

export interface SettingsAiSectionProps {
  showAll: boolean;
}

/**
 * AI player settings.
 *
 * This section explains setup but never asks for the key: a key typed into a
 * web form would end up in the browser, in this repo's issue reports, and in
 * screenshots. The key lives in the server environment, and the UI reports
 * whether the server found it.
 */
export function SettingsAiSection({ showAll }: SettingsAiSectionProps): JSX.Element {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AiPlayerStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const response = await fetch("/api/ai/status", { headers: { Accept: "application/json" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as AiPlayerStatus;
        if (!cancelled) {
          setStatus(body);
          setError(null);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "unavailable");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const configured = status?.configured === true;

  return (
    <section className="settings-section">
      {showAll && <div className="settings-section-context">{t("settings.sections.ai")}</div>}
      <div className="settings-section-header">
        <Sparkles size={18} />
        <h2>{t("settings.ai.title")}</h2>
        <p className="settings-hint">{t("settings.ai.description")}</p>
      </div>

      <div className="settings-rows">
        <div className="settings-row">
          <div className="settings-label">
            {t("settings.ai.statusLabel")}
            <span className="settings-hint">
              {loading
                ? t("settings.ai.statusChecking")
                : configured
                  ? t("settings.ai.statusReady")
                  : t("settings.ai.statusMissing")}
            </span>
          </div>
          <div className={`settings-ai-badge${configured ? " settings-ai-badge--ok" : " settings-ai-badge--warn"}`}>
            {configured ? <CheckCircle2 size={14} /> : <ShieldAlert size={14} />}
            <span>{configured ? t("settings.ai.badgeReady") : t("settings.ai.badgeMissing")}</span>
          </div>
        </div>

        {error && (
          <div className="settings-row">
            <p className="settings-hint settings-hint--warn">{t("settings.ai.statusError")}</p>
          </div>
        )}

        {status && (
          <div className="settings-row">
            <div className="settings-label">
              {t("settings.ai.modelLabel")}
              <span className="settings-hint">{t("settings.ai.modelHint")}</span>
            </div>
            <code className="settings-ai-code">{status.model}</code>
          </div>
        )}

        <div className="settings-row settings-row--stacked">
          <div className="settings-label">
            <KeyRound size={14} />
            {t("settings.ai.keyLabel")}
          </div>
          <div className="settings-ai-steps">
            <ol>
              <li>
                {t("settings.ai.step1")}{" "}
                <a href="https://numes.ai/dashboard/keys" target="_blank" rel="noreferrer noopener">
                  numes.ai/dashboard/keys
                </a>
              </li>
              <li>{t("settings.ai.step2")}</li>
              <li>{t("settings.ai.step3")}</li>
            </ol>
            <pre className="settings-ai-env">
{`NUMES_API_KEY=sk-...
# optional
NUMES_BASE_URL=https://api.numes.ai/api/v1
AI_PLAYER_MODEL=z-ai/glm-5.3
AI_PLAYER_DAILY_REQUESTS=200`}
            </pre>
            <p className="settings-hint">{t("settings.ai.keyWarning")}</p>
          </div>
        </div>

        <div className="settings-row settings-row--stacked">
          <div className="settings-label">{t("settings.ai.usageLabel")}</div>
          <p className="settings-hint">{t("settings.ai.usageHint")}</p>
        </div>
      </div>
    </section>
  );
}
