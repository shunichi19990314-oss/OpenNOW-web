import { Loader2 } from "lucide-react";
import { useTranslation } from "../i18n";
import { m } from "motion/react";
import type { JSX } from "react";
import { spinnerTransition } from "./MotionProvider";

interface MotionSpinnerProps {
  size?: number;
  className?: string;
  label?: string;
}

export function MotionSpinner({
  size = 20,
  className,
  label,
}: MotionSpinnerProps): JSX.Element {
  const { t } = useTranslation();
  const ariaLabel = label ?? t("accessibility.loading");
  return (
    <m.span
      className={["motion-spinner", className].filter(Boolean).join(" ")}
      animate={{ rotate: 360 }}
      transition={spinnerTransition}
      role="status"
      aria-label={ariaLabel}
    >
      <Loader2 size={size} aria-hidden="true" />
    </m.span>
  );
}
