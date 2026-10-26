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

interface RouteState {
  route: Route;
  readerRequest: ReaderOpenRequest | null;
  setRoute: (r: Route) => void;
  openReader: (request: ReaderOpenRequest) => void;
  closeReader: () => void;
}

export const useRouteStore = create<RouteState>((set) => ({
  route: "library",
  readerRequest: null,
  setRoute: (route) => set({ route, ...(route === "reader" ? {} : { readerRequest: null }) }),
  openReader: (readerRequest) => set({ route: "reader", readerRequest }),
  closeReader: () => set({ route: "library", readerRequest: null }),
}));
