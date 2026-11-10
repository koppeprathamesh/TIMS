/* eslint-disable @next/next/no-img-element -- images are user-supplied URLs or data URLs, which next/image cannot optimize */
import type { ReactNode } from "react";
import Link from "next/link";
import FacilityIcon from "@/components/icons/FacilityIcon";

export interface EntityCardProps {
  title: string;
  /** Short identifier shown under the title, e.g. the facility code. */
  subtitle?: string;
  description?: string | null;
  imageUrl?: string | null;
  badge?: string;
  /** Makes the whole card a link. */
  href?: string;
  /** Makes the whole card a button. */
  onClick?: () => void;
  disabled?: boolean;
  footer?: ReactNode;
  actionLabel?: string;
}

// Shared card layout for facilities and departments: image, title, info.
export default function EntityCard({
  title,
  subtitle,
  description,
  imageUrl,
  badge,
  href,
  onClick,
  disabled,
  footer,
  actionLabel,
}: EntityCardProps) {
  const hasDescription = Boolean(description && description.trim());
  const body = (
    <>
      <div className="relative aspect-[16/9] w-full overflow-hidden rounded-t-[var(--radius-card)] bg-[var(--color-surface-muted)]">
        {imageUrl ? (
          <>
            {/* Blurred copy fills the frame so any image shape looks intentional; the sharp copy is never cropped. */}
            <img
              src={imageUrl}
              alt=""
              aria-hidden="true"
              className="absolute inset-0 h-full w-full scale-110 object-cover opacity-60 blur-xl"
              loading="lazy"
            />
            <img
              src={imageUrl}
              alt={`${title} image`}
              className="absolute inset-0 h-full w-full object-contain p-2"
              loading="lazy"
            />
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]">
            <FacilityIcon className="h-16 w-16 opacity-60" />
          </div>
        )}
        {badge && (
          <span className="absolute right-2 top-2 rounded-full bg-[var(--color-warning)] px-2 py-0.5 text-xs font-medium text-white">
            {badge}
          </span>
        )}
      </div>
      <div className="space-y-1 p-4 text-left">
        <h3 className="break-words text-lg font-semibold leading-snug">{title}</h3>
        {subtitle && <p className="text-sm text-[var(--color-text-muted)]">{subtitle}</p>}
        {hasDescription && (
          <p className="line-clamp-3 text-sm text-[var(--color-text-muted)]">{description}</p>
        )}
        {actionLabel && <span className="block pt-2 text-sm font-medium text-[var(--color-primary)]">{actionLabel} →</span>}
      </div>
    </>
  );

  const baseClass = "card block w-full overflow-hidden transition-all disabled:opacity-60";
  const className = `${baseClass} hover:-translate-y-0.5 hover:border-[var(--color-primary)] hover:shadow-md`;

  return (
    <div className="flex flex-col">
      {href ? (
        <Link href={href} className={className}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" onClick={onClick} disabled={disabled} className={className}>
          {body}
        </button>
      ) : (
        <div className={baseClass}>{body}</div>
      )}
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}
