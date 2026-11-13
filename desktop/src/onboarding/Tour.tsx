import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { FolioButton } from "../components/FolioButton";
import { FolioIcons } from "../components/FolioIcons";
import { trapTabKey } from "../components/focusTrap";
import { pushToast } from "../shell/toasts";
import { isTopModal, popModal, pushModal } from "../shell/modalStack";
import { useRouteStore } from "../store/routeStore";
import type { Route } from "../shell/Sidebar";
import { useOnboarding } from "./onboardingState";

interface TourStep {
  title: string;
  body: string;
  route?: Route;
  /** `data-tour` attribute of the element to spotlight. */
  anchor?: string;
}

const STEPS: TourStep[] = [
  {
    title: "Your library",
    body: "Every book, article, and text file you import lives here. Search across the whole library, filter by collection, and pick up where you left off.",
    route: "library",
    anchor: "library-search",
  },
  {
    title: "Reading",
    body: "Open a book to read it. The top bar holds contents, search, bookmarks, and appearance; the bottom dock shows progress. Your place is saved automatically.",
    route: "library",
    anchor: "import",
  },
  {
    title: "Collections",
    body: "Group books into collections for projects, courses, or moods. Collections are separate from notes, so each stays focused on one job.",
    route: "collections",
    anchor: "nav-collections",
  },
  {
    title: "Notes",
    body: "Highlights, notes, and bookmarks from every book appear here. Select one to jump straight back to the passage that inspired it.",
    route: "notes",
    anchor: "nav-notes",
  },
  {
    title: "Settings",
    body: "Change app appearance, set default reading preferences, and manage backups. That's the whole tour — replay it from Settings whenever you like.",
    route: "settings",
    anchor: "nav-settings",
  },
];

const CARD_WIDTH = 400;
const CARD_GAP = 20;

function cardStyleFor(rect: DOMRect | null): CSSProperties | undefined {
  if (!rect || typeof window === "undefined") return undefined;
  const width = Math.min(CARD_WIDTH, window.innerWidth - 32);
  let left = rect.right + CARD_GAP;
  if (left + width > window.innerWidth - 16) {
    left = rect.left - width - CARD_GAP;
  }
  if (left < 16) left = Math.max(16, (window.innerWidth - width) / 2);
  const top = Math.max(16, Math.min(rect.top - 8, window.innerHeight - 280));
  return { position: "fixed", left, top, width };
}

/** Five-step welcome tour shown once after first-run setup. */
export function Tour() {
  const completeTour = useOnboarding((s) => s.completeTour);
  const dismissTour = useOnboarding((s) => s.dismissTour);
  const setRoute = useRouteStore((s) => s.setRoute);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const originRef = useRef<Route>(useRouteStore.getState().route);
  const step = STEPS[index];
  const last = index === STEPS.length - 1;

  useEffect(() => {
    if (step.route) setRoute(step.route);
  }, [step.route, setRoute]);

  // The shell is visible but not interactive underneath the tour.
  useEffect(() => {
    const app = document.querySelector<HTMLElement>(".folio-app");
    if (!app) return;
    const prevAria = app.getAttribute("aria-hidden");
    app.setAttribute("inert", "");
    app.setAttribute("aria-hidden", "true");
    return () => {
      app.removeAttribute("inert");
      if (prevAria === null) app.removeAttribute("aria-hidden");
      else app.setAttribute("aria-hidden", prevAria);
    };
  }, []);

  // Move focus to the step heading; the focus trap wraps from non-tab stops.
  useEffect(() => {
    titleRef.current?.focus();
  }, [index]);

  // Measure the spotlight target after the route change has painted. A short
  // retry covers screens that populate asynchronously (the library refresh).
  useEffect(() => {
    if (!step.anchor) {
      setRect(null);
      return;
    }
    let raf = 0;
    let timer = 0;
    const measure = () => {
      const target = document.querySelector<HTMLElement>(`[data-tour="${step.anchor}"]`);
      setRect(target ? target.getBoundingClientRect() : null);
    };
    measure();
    raf = requestAnimationFrame(measure);
    timer = window.setTimeout(measure, 80);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
  }, [index, step.anchor]);

  const finish = () => {
    completeTour();
    setRoute("library");
  };

  // Escape and a backdrop click are accidental far more often than deliberate:
  // close the tour for this session only and say where it can be replayed.
  const dismiss = useCallback(() => {
    dismissTour();
    setRoute(originRef.current);
    pushToast({
      tone: "info",
      text: "Tour closed. You can replay it any time from Settings.",
    });
  }, [dismissTour, setRoute]);

  useEffect(() => {
    const token = pushModal();
    const onKey = (e: KeyboardEvent) => {
      if (!isTopModal(token)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        dismiss();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      popModal(token);
    };
  }, [dismiss]);

  const next = () => {
    if (last) finish();
    else setIndex((i) => i + 1);
  };

  const style = cardStyleFor(rect);

  return (
    <div className="folio-tour" data-folio-modal>
      <div
        className={`folio-tour__backdrop${rect ? " folio-tour__backdrop--clear" : ""}`}
        aria-hidden="true"
        onClick={dismiss}
      />
      {rect && (
        <div
          className="folio-tour__spotlight"
          style={{
            top: rect.top - 4,
            left: rect.left - 4,
            width: rect.width + 8,
            height: rect.height + 8,
          }}
          aria-hidden="true"
        />
      )}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- focus-trap container: keydown only handles Tab trapping, all inner controls are focusable */}
      <div
        ref={cardRef}
        className={`folio-tour__card${rect ? " folio-tour__card--anchored" : ""}`}
        style={style}
        role="dialog"
        aria-modal="true"
        aria-labelledby="folio-tour-title"
        onKeyDown={(e) => {
          if (cardRef.current) trapTabKey(cardRef.current, e.nativeEvent);
        }}
      >
        <div className="folio-tour__step" aria-live="polite">
          Step {index + 1} of {STEPS.length}
        </div>
        <h2 id="folio-tour-title" className="folio-tour__title" ref={titleRef} tabIndex={-1}>
          {step.title}
        </h2>
        <p className="folio-tour__body">{step.body}</p>

        <div className="folio-tour__dots" aria-hidden="true">
          {STEPS.map((s, i) => (
            <span key={s.title} className={`folio-tour__dot${i === index ? " is-active" : ""}`} />
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
          aria-label="Close tour for now"
          onClick={dismiss}
        >
          <FolioIcons.Close size="sm" />
        </button>
      </div>
    </div>
  );
}
