import { useEffect, useRef, useState } from "react";
import { FolioButton } from "../components/FolioButton";
import { FolioIcons } from "../components/FolioIcons";
import { focusFirstIn, trapTabKey } from "../components/focusTrap";
import { useRouteStore } from "../store/routeStore";
import type { Route } from "../shell/Sidebar";
import { useOnboarding } from "./onboardingState";

interface TourStep {
  title: string;
  body: string;
  route?: Route;
}

const STEPS: TourStep[] = [
  {
    title: "Library",
    body: "Every book, article, and text file you import lives here. Search across your whole library, filter by collection, and pick up where you left off.",
    route: "library",
  },
  {
    title: "Reader",
    body: "Open a book to read it. The top bar holds contents, search, bookmarks, and appearance; the bottom dock shows progress. Your place is saved automatically.",
  },
  {
    title: "Collections",
    body: "Group books into collections for projects, courses, or moods. Collections are separate from notes, so each stays focused on one job.",
    route: "collections",
  },
  {
    title: "Notes",
    body: "Highlights, notes, and bookmarks from every book appear here. Select one to jump straight back to the passage that inspired it.",
    route: "notes",
  },
  {
    title: "Settings",
    body: "Change app appearance, set default reading preferences, manage backups, and replay this tour whenever you like.",
    route: "settings",
  },
];

/** Five-step welcome tour shown once after first-run setup. */
export function Tour() {
  const completeTour = useOnboarding((s) => s.completeTour);
  const setRoute = useRouteStore((s) => s.setRoute);
  const [index, setIndex] = useState(0);
  const cardRef = useRef<HTMLDivElement>(null);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  useEffect(() => {
    if (step.route) setRoute(step.route);
  }, [step.route, setRoute]);

  useEffect(() => {
    if (cardRef.current) focusFirstIn(cardRef.current);
  }, [index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finish();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
    // finish is stable for the lifetime of this overlay
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = () => {
    setRoute("library");
    completeTour();
  };

  const next = () => {
    if (last) finish();
    else setIndex((i) => i + 1);
  };

  return (
    <div className="folio-tour" data-folio-modal>
      <div
        className="folio-tour__backdrop"
        aria-hidden="true"
        onClick={finish}
      />
      <div
        ref={cardRef}
        className="folio-tour__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="folio-tour-title"
        onKeyDown={(e) => {
          trapTabKey(cardRef.current!, e.nativeEvent);
        }}
      >
        <div className="folio-tour__step">
          Step {index + 1} of {STEPS.length}
        </div>
        <h2 id="folio-tour-title" className="folio-tour__title">
          {step.title}
        </h2>
        <p className="folio-tour__body">{step.body}</p>

        <div className="folio-tour__dots" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span
              key={s.title}
              className={`folio-tour__dot${i === index ? " is-active" : ""}`}
            />
          ))}
        </div>

        <div className="folio-tour__actions">
          <FolioButton variant="ghost" onClick={finish}>
            Skip tour
          </FolioButton>
          <div className="folio-tour__nav">
            {index > 0 && (
              <FolioButton variant="secondary" onClick={() => setIndex((i) => i - 1)}>
                Back
              </FolioButton>
            )}
            <FolioButton variant="primary" onClick={next} data-autofocus>
              {last ? "Start reading" : "Next"}
            </FolioButton>
          </div>
        </div>

        <button
          type="button"
          className="folio-iconbtn folio-tour__close"
          aria-label="Close tour"
          onClick={finish}
        >
          <FolioIcons.Close size="sm" />
        </button>
      </div>
    </div>
  );
}
