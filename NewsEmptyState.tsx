import { Newspaper } from "lucide-react";

interface NewsEmptyStateProps {
  title?: string;
  message?: string;
  compact?: boolean;
}

export function NewsEmptyState({
  title = "No news available",
  message = "The AJN news service has not returned any normalized headlines yet.",
  compact = false,
}: NewsEmptyStateProps) {
  return (
    <div
      role="status"
      className={`rounded-xl border border-neutral-800 bg-neutral-900/60 text-center ${
        compact ? "px-4 py-5" : "px-6 py-10"
      }`}
    >
      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full border border-neutral-700 bg-neutral-950 text-neutral-500">
        <Newspaper className="h-4 w-4" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-neutral-200">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-neutral-500">{message}</p>
    </div>
  );
}
