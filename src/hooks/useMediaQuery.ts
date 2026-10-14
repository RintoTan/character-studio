import { useEffect, useState } from "react";

/**
 * Tracks a media query in React, for the cases a stylesheet cannot cover: a
 * disclosure that is folded on a phone is a change of what is rendered, not a
 * change of how it looks.
 */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() =>
    typeof window === "undefined" ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);

    update();
    list.addEventListener("change", update);
    return () => list.removeEventListener("change", update);
  }, [query]);

  return matches;
}
