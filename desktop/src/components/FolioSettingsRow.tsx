import type { ReactNode } from "react";

interface FolioSettingsRowProps {
  title: string;
  helper?: string;
  control?: ReactNode;
  onClick?: () => void;
}

/** Settings row, min-height 56 (03 §4/§5.7): title + optional helper + control slot. */
export function FolioSettingsRow({ title, helper, control, onClick }: FolioSettingsRowProps) {
  const body = (
    <>
      <div className="folio-settings-row__body">
        <div className="folio-settings-row__title">{title}</div>
        {helper && <div className="folio-settings-row__helper">{helper}</div>}
      </div>
      {control && <div className="folio-settings-row__control">{control}</div>}
    </>
  );
  if (onClick) {
    return (
      <button type="button" className="folio-settings-row folio-row--clickable" onClick={onClick}>
        {body}
      </button>
    );
  }
  return <div className="folio-settings-row">{body}</div>;
}
