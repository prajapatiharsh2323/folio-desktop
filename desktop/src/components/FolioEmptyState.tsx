import type { ReactNode } from "react";

interface FolioEmptyStateProps {
  title: string;
  body?: string;
  action?: ReactNode;
}

/** Empty state: display serif title + explanation + primary action (03 §5.2). */
export function FolioEmptyState({ title, body, action }: FolioEmptyStateProps) {
  return (
    <div className="folio-empty">
      <h2 className="folio-empty__title">{title}</h2>
      {body && <p className="folio-empty__body">{body}</p>}
      {action}
    </div>
  );
}
