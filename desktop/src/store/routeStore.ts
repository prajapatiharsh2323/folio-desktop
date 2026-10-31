import { create } from "zustand";
import type { Route } from "../shell/Sidebar";

/** Options for opening the reader (04 §8 resume cascade step 1). */
export interface ReaderOpenRequest {
  docId: string;
  /** chapter href / href#fragment (annotation or search hit) */
  location?: string | null;
  /** 0..100 total progression fallback */
  percent?: number | null;
  /** second-step text-quote jump */
  anchor?: { quote: string; prefix: string; suffix: string } | null;
}

/**
 * Where the reader was opened from (04 §5 navigation). `closeReader` returns
 * to this route; the Collections screen additionally restores the collection
 * whose list the user was viewing when they opened the book.
 */
export interface ReaderOrigin {
  /** Screen to return to — never "reader". */
  route: Route;
  /** Collection detail to restore when `route` is "collections". */
  collectionId?: string | null;
}

interface RouteState {
  route: Route;
  readerRequest: ReaderOpenRequest | null;
  readerOrigin: ReaderOrigin | null;
  setRoute: (r: Route) => void;
  openReader: (request: ReaderOpenRequest, origin?: ReaderOrigin) => void;
  closeReader: () => void;
}

export const useRouteStore = create<RouteState>((set, get) => ({
  route: "library",
  readerRequest: null,
  readerOrigin: null,
  setRoute: (route) =>
    set({ route, ...(route === "reader" ? {} : { readerRequest: null, readerOrigin: null }) }),
  openReader: (readerRequest, origin) =>
    set(() => {
      // The sidebar is hidden in the reader, so openReader normally runs from
      // a library screen; keep the previous origin if it ever runs again while
      // inside the reader (programmatic re-open of the same book).
      const state = get();
      const fallbackRoute: Route =
        state.route === "reader"
          ? (state.readerOrigin?.route ?? "library")
          : state.route;
      const readerOrigin: ReaderOrigin =
        origin ??
        (fallbackRoute === "collections"
          ? { route: "collections", collectionId: null }
          : { route: fallbackRoute, collectionId: null });
      return { route: "reader", readerRequest, readerOrigin };
    }),
  closeReader: () =>
    set((state) => ({
      route:
        state.readerOrigin?.route && state.readerOrigin.route !== "reader"
          ? state.readerOrigin.route
          : "library",
      readerRequest: null,
      // readerOrigin is kept until the next openReader/setRoute: the
      // Collections screen consumes `collectionId` once when it remounts.
    })),
}));
