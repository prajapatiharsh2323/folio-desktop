import { FolioDialog } from "./FolioDialog";
import { FolioButton } from "./FolioButton";

interface KeyboardShortcutsDialogProps {
  open: boolean;
  onClose: () => void;
}

interface ShortcutGroup {
  title: string;
  items: { keys: string[]; description: string }[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Page Navigation",
    items: [
      { keys: ["→", "PageDown", "Space", "↓"], description: "Turn to next page" },
      { keys: ["←", "PageUp", "Shift + Space", "↑"], description: "Turn to previous page" },
      { keys: ["Home"], description: "Jump to start of book" },
      { keys: ["End"], description: "Jump to end of book" },
      { keys: ["Media Next / Prev"], description: "Hardware page turn keys" },
    ],
  },
  {
    title: "Reading Tools",
    items: [
      { keys: ["T"], description: "Open Table of Contents & Workspace" },
      { keys: ["Ctrl", "F"], description: "Search in book" },
      { keys: ["Ctrl", "B"], description: "Toggle bookmark at current position" },
    ],
  },
  {
    title: "View & Controls",
    items: [
      { keys: ["M"], description: "Toggle reading controls (toolbar & dock)" },
      { keys: ["F"], description: "Toggle Focus Mode (distraction-free reading)" },
      { keys: ["?"], description: "Open this keyboard shortcuts guide" },
      { keys: ["Escape"], description: "Dismiss open menu, panel, dialog, or search" },
    ],
  },
];

/**
 * Keyboard Shortcuts Guide dialog (Phase 7.3):
 * Discoverable modal under More and via `?` showing all reader shortcuts.
 */
export function KeyboardShortcutsDialog({ open, onClose }: KeyboardShortcutsDialogProps) {
  return (
    <FolioDialog
      open={open}
      onClose={onClose}
      title="Keyboard Shortcuts"
      actions={
        <FolioButton variant="primary" onClick={onClose}>
          Got it
        </FolioButton>
      }
    >
      <div className="folio-shortcuts-guide">
        {SHORTCUT_GROUPS.map((group) => (
          <div key={group.title} className="folio-shortcuts-guide__group">
            <h3 className="folio-shortcuts-guide__title">{group.title}</h3>
            <ul className="folio-shortcuts-guide__list">
              {group.items.map((item, i) => (
                <li key={i} className="folio-shortcuts-guide__row">
                  <span className="folio-shortcuts-guide__desc">{item.description}</span>
                  <div className="folio-shortcuts-guide__keys">
                    {item.keys.map((k, ki) => (
                      <kbd key={ki} className="folio-shortcuts-guide__kbd">
                        {k}
                      </kbd>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </FolioDialog>
  );
}

