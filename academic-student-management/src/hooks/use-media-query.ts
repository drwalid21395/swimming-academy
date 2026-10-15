"use client";

import { useEffect, useState } from "react";

/**
 * Tracks a CSS media query from React.
 *
 * Used where both layouts would otherwise be in the DOM at once. Rendering a card
 * list *and* a table for the same rows doubles the nodes for the collection, and
 * for a few hundred students that is enough for the browser to report the page as
 * unresponsive.
 *
 * `false` is returned until the first client render so the server and the client
 * agree on the markup and React does not report a hydration mismatch.
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);

    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}

/** The `md` breakpoint the responsive layouts switch at. */
export function useIsDesktop() {
  return useMediaQuery("(min-width: 768px)");
}