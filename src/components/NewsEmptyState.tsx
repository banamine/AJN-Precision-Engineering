import { Newspaper } from "lucide-react";

export function NewsEmptyState({ title = "No news available", message = "No normalized AJN headlines are available right now." }: { title?: string; message?: string }) {
  return (
    <div role="status" className="rounded-xl border border-neutral-800 bg-neutral-900/60 px-6 py-8 text-center">
      <Newspaper className="mx-auto h-5 w-5 text-neutral-500" />
      <h3 className="mt-3 text-sm font-semibold text-neutral-200">{title}</h3>
      <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-neutral-500">{message}</p>
    </div>
  );
}
