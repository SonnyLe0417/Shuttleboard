import type { ReactNode } from "react";
import { AlertCircle, Inbox, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("app-page-header", className)}>
      <div className="min-w-0 space-y-2">
        {eyebrow && <p className="eyebrow text-primary">{eyebrow}</p>}
        <h1 className="app-page-title">{title}</h1>
        {description && <p className="app-page-description">{description}</p>}
      </div>
      {actions && <div className="app-page-actions">{actions}</div>}
    </header>
  );
}

type SectionHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function SectionHeader({
  eyebrow,
  title,
  description,
  actions,
  className,
}: SectionHeaderProps) {
  return (
    <div className={cn("app-section-header", className)}>
      <div className="min-w-0 space-y-1.5">
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h2 className="app-section-title">{title}</h2>
        {description && <p className="app-section-description">{description}</p>}
      </div>
      {actions && <div className="app-page-actions">{actions}</div>}
    </div>
  );
}

export function Surface({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bento-tile app-surface", className)} {...props} />;
}

type EmptyStateProps = {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn("app-state app-empty-state", className)}>
      <span className="app-state-icon" aria-hidden="true">
        <Inbox className="h-5 w-5" />
      </span>
      <h3 className="app-state-title">{title}</h3>
      {description && <p className="app-state-description">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadingState({
  label = "Loading",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("app-state", className)} role="status" aria-live="polite">
      <Loader2 className="app-state-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

type ErrorStateProps = {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
};

export function ErrorState({
  title = "Something went wrong",
  description = "Try again, or come back in a moment.",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div className={cn("app-state app-error-state", className)} role="alert">
      <span className="app-state-icon app-state-icon-error" aria-hidden="true">
        <AlertCircle className="h-5 w-5" />
      </span>
      <h3 className="app-state-title">{title}</h3>
      <p className="app-state-description">{description}</p>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" className="mt-4" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function LoadingSurface({ className }: { className?: string }) {
  return (
    <Surface className={cn("space-y-4 p-5", className)} aria-hidden="true">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-24 w-full" />
    </Surface>
  );
}
