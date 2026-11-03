import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import QRCode from "qrcode";
import { Check, ChevronDown, Copy, ExternalLink, QrCode } from "lucide-react";
import { AnimatePresence, m } from "motion/react";
import type { AuthDeviceLoginChallenge, LoginProvider } from "@shared/gfn";
import { formatCodeCountdown, prefersLinkOverQr } from "../lib/deviceLoginFlow";
import { useTranslation } from "../i18n";
import { OpenNowLogoMark } from "./OpenNowLogoMark";
import { MotionSpinner } from "./MotionSpinner";
import { dialogMotion, smoothEase } from "./MotionProvider";

export interface LoginScreenProps {
  providers: LoginProvider[];
  selectedProviderId: string;
  onProviderChange: (id: string) => void;
  onQrLogin: () => void;
  onCancelQrLogin: () => void;
  isLoading: boolean;
  error: string | null;
  isInitializing?: boolean;
  statusMessage?: string;
  qrLoginChallenge?: AuthDeviceLoginChallenge | null;
  isQrLoginPending?: boolean;
  /** Codes already replaced automatically after expiring (drives the notice). */
  qrRenewalsUsed?: number;
}

export function LoginScreen({
  providers,
  selectedProviderId,
  onProviderChange,
  onQrLogin,
  onCancelQrLogin,
  isLoading,
  error,
  isInitializing = false,
  statusMessage,
  qrLoginChallenge,
  isQrLoginPending = false,
  qrRenewalsUsed = 0,
}: LoginScreenProps): JSX.Element {
  const { t } = useTranslation();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  // Seeded eagerly so the countdown is present on the very first paint instead
  // of appearing a tick later when the interval effect runs.
  const [remainingMs, setRemainingMs] = useState<number | null>(
    () => (qrLoginChallenge ? qrLoginChallenge.expiresAt - Date.now() : null),
  );
  const [isCodeCopied, setIsCodeCopied] = useState(false);
  // A phone or tablet cannot photograph its own screen, so on touch-first
  // devices the sign-in link leads and the QR becomes the secondary path.
  const [isLinkFirst, setIsLinkFirst] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const copyResetTimerRef = useRef<number | null>(null);

  const selectedProvider = providers.find((p) => p.idpId === selectedProviderId);
  const title = isInitializing ? t("auth.title.restoringSession") : t("auth.title.signIn");
  const subtitle = isInitializing ? t("auth.subtitle.checkingSavedAccounts") : t("app.description");
  const isQrLoginActive = Boolean(qrLoginChallenge) || isQrLoginPending;

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setQrCodeDataUrl(null);

    if (!qrLoginChallenge) {
      return () => {
        cancelled = true;
      };
    }

    QRCode.toDataURL(qrLoginChallenge.verificationUriComplete, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 8,
      color: {
        dark: "#07111f",
        light: "#ffffff",
      },
    }).then((dataUrl) => {
      if (!cancelled) {
        setQrCodeDataUrl(dataUrl);
      }
    }).catch(() => {
      if (!cancelled) {
        setQrCodeDataUrl(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [qrLoginChallenge]);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const coarsePointer = window.matchMedia("(pointer: coarse)");
    const narrowViewport = window.matchMedia("(max-width: 720px)");
    const update = () => setIsLinkFirst(prefersLinkOverQr(coarsePointer.matches, narrowViewport.matches));
    update();
    coarsePointer.addEventListener("change", update);
    narrowViewport.addEventListener("change", update);
    return () => {
      coarsePointer.removeEventListener("change", update);
      narrowViewport.removeEventListener("change", update);
    };
  }, []);

  // Live countdown so an expiring code is visible before it silently dies.
  useEffect(() => {
    if (!qrLoginChallenge) {
      setRemainingMs(null);
      return;
    }
    const update = () => setRemainingMs(qrLoginChallenge.expiresAt - Date.now());
    update();
    const timer = window.setInterval(update, 1000);
    // Hidden tabs throttle intervals; resync the moment the visitor returns.
    const onVisible = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") update();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [qrLoginChallenge]);

  useEffect(() => {
    setIsCodeCopied(false);
  }, [qrLoginChallenge?.userCode]);

  useEffect(() => () => {
    if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
  }, []);

  const handleCopyUserCode = useCallback(async () => {
    const code = qrLoginChallenge?.userCode;
    if (!code) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        // Clipboard API needs a secure context; fall back for plain-HTTP LAN use.
        const scratch = document.createElement("textarea");
        scratch.value = code;
        scratch.setAttribute("readonly", "");
        scratch.style.position = "fixed";
        scratch.style.opacity = "0";
        document.body.appendChild(scratch);
        scratch.select();
        document.execCommand("copy");
        document.body.removeChild(scratch);
      }
      setIsCodeCopied(true);
      if (copyResetTimerRef.current !== null) window.clearTimeout(copyResetTimerRef.current);
      copyResetTimerRef.current = window.setTimeout(() => setIsCodeCopied(false), 2000);
    } catch (error) {
      console.warn("[Login] Copying the sign-in code failed.", error);
    }
  }, [qrLoginChallenge?.userCode]);

  const handleProviderSelect = (providerId: string) => {
    onProviderChange(providerId);
    setIsDropdownOpen(false);
  };

  return (
    <div className="login-screen">
      <div className="login-bg">
        <m.div
          className="login-bg-orb login-bg-orb--1"
          animate={{ x: [0, -40, 0], y: [0, 30, 0], scale: [1, 1.15, 1] }}
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        />
        <m.div
          className="login-bg-orb login-bg-orb--2"
          animate={{ x: [0, 50, 0], y: [0, -35, 0], scale: [1, 1.1, 1] }}
          transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }}
        />
        <m.div
          className="login-bg-orb login-bg-orb--3"
          animate={{ x: [0, 30, 0], y: [0, 20, 0], scale: [1, 0.9, 1] }}
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="login-bg-noise" />
      </div>

      <m.div className="login-content" {...dialogMotion}>
        {/* Brand */}
        <div className="login-brand">
          <div className="login-brand-mark">
            <OpenNowLogoMark className="opennow-logo-mark" />
          </div>
          <span className="login-brand-name">OpenNOW</span>
        </div>

        {/* Card */}
        <div className="login-card">
          <div className="login-card-header">
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>

          {error && (
            <div className="login-error">
              <span className="login-error-dot" />
              {error}
            </div>
          )}

          {isInitializing && statusMessage && (
            <div className="login-status" role="status" aria-live="polite">
              <m.span
                className="login-status-dot"
                animate={{ opacity: [0.55, 1, 0.55], scale: [0.9, 1.12, 0.9] }}
                transition={{ duration: 1.7, repeat: Infinity, ease: "easeInOut" }}
              />
              {statusMessage}
            </div>
          )}

          <div className="login-field" ref={dropdownRef}>
            <label className="login-label">{t("auth.provider.label")}</label>
            <button
              className={`login-select ${isDropdownOpen ? "open" : ""}`}
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              disabled={isLoading || isInitializing || isQrLoginActive}
              type="button"
            >
              <span className="login-select-text">
                {isInitializing
                  ? t("auth.provider.loading")
                  : selectedProvider?.displayName ?? t("auth.provider.select")}
              </span>
              <ChevronDown
                size={16}
                className={`login-select-chevron ${isDropdownOpen ? "rotated" : ""}`}
              />
            </button>

            <AnimatePresence>
              {isDropdownOpen && (
              <m.div
                className="login-dropdown"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.14, ease: smoothEase }}
              >
                {providers.map((provider) => (
                  <button
                    key={provider.idpId}
                    className={`login-dropdown-item ${provider.idpId === selectedProviderId ? "selected" : ""}`}
                    onClick={() => handleProviderSelect(provider.idpId)}
                    type="button"
                  >
                    <span>{provider.displayName}</span>
                    {provider.idpId === selectedProviderId && (
                      <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                      </svg>
                    )}
                  </button>
                ))}
              </m.div>
              )}
            </AnimatePresence>
          </div>

          {isQrLoginActive && (
            <div
              className={isLinkFirst ? "login-qr-panel login-qr-panel--link-first" : "login-qr-panel"}
              role="status"
              aria-live="polite"
            >
              {qrLoginChallenge?.verificationUriComplete && (
                <a
                  className="login-button login-qr-link"
                  href={qrLoginChallenge.verificationUriComplete}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink size={18} />
                  <span>{t("auth.qr.openOnDevice")}</span>
                </a>
              )}

              <div className="login-qr-code">
                {qrLoginChallenge && qrCodeDataUrl ? (
                  <img src={qrCodeDataUrl} alt={t("auth.qr.alt")} />
                ) : (
                  <MotionSpinner className="login-motion-spinner" size={16} label={t("common.loading")} />
                )}
              </div>

              <div className="login-qr-copy">
                <div className="login-qr-title">
                  {qrLoginChallenge
                    ? (isLinkFirst ? t("auth.qr.titleLinkFirst") : t("auth.qr.title"))
                    : (qrRenewalsUsed > 0 ? t("auth.qr.renewing") : t("auth.qr.preparing"))}
                </div>
                <p>
                  {qrLoginChallenge
                    ? (isLinkFirst ? t("auth.qr.descriptionLinkFirst") : t("auth.qr.description"))
                    : (qrRenewalsUsed > 0 ? t("auth.qr.renewingDescription") : t("auth.qr.preparingDescription"))}
                </p>

                {qrLoginChallenge && (
                  <>
                    <div className="login-qr-code-row">
                      <code>{qrLoginChallenge.userCode}</code>
                      <button
                        className="login-qr-copy-button"
                        onClick={() => void handleCopyUserCode()}
                        type="button"
                        title={t("auth.qr.copyCode")}
                      >
                        {isCodeCopied ? <Check size={14} /> : <Copy size={14} />}
                        <span>{isCodeCopied ? t("auth.qr.codeCopied") : t("auth.qr.copyCode")}</span>
                      </button>
                    </div>
                    {qrRenewalsUsed > 0 && (
                      <p className="login-qr-renewed">{t("auth.qr.renewed")}</p>
                    )}
                    {remainingMs !== null && (
                      <span className="login-qr-countdown">
                        {t("auth.qr.expiresIn", { time: formatCodeCountdown(remainingMs) })}
                      </span>
                    )}
                    {qrLoginChallenge.verificationUri && (
                      <p className="login-qr-manual">
                        {t("auth.qr.enterCodeHint", { uri: qrLoginChallenge.verificationUri })}
                      </p>
                    )}
                  </>
                )}
              </div>

              <button
                className="login-secondary-button"
                onClick={onCancelQrLogin}
                type="button"
              >
                {t("auth.actions.cancelQrLogin")}
              </button>
            </div>
          )}

          <div className="login-actions">
            <button
              className={`login-button ${isLoading || isInitializing ? "loading" : ""}`}
              onClick={onQrLogin}
              disabled={isLoading || isInitializing || isQrLoginActive || !selectedProviderId}
              type="button"
            >
              {isLoading || isInitializing ? (
                <>
                  <MotionSpinner className="login-motion-spinner" size={16} label={t("common.loading")} />
                  <span>{isInitializing ? t("auth.actions.restoringSession") : t("auth.actions.connecting")}</span>
                </>
              ) : (
                <>
                  <QrCode size={18} />
                  <span>{t("auth.actions.signInWithQr")}</span>
                </>
              )}
            </button>
          </div>
        </div>

        <p className="login-footer">{t("app.tagline")}</p>
      </m.div>
    </div>
  );
}
