import { useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";

// The folds clip with `max-h-44`, which is 11rem.
const FOLDED_HEIGHT_REM = 11;

/**
 * Put `ref` on the unclipped content inside a fold. `tallEnough` is true when that content is at
 * least twice the folded height, so opening a fold always at least doubles what was on screen.
 */
export function useTallEnoughToFold(enabled = true, foldLines?: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [tallEnough, setTallEnough] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the fold depends on the rendered height, which only the DOM knows
  useLayoutEffect(() => {
    const content = ref.current;
    if (!enabled || !content) return;
    const measure = () => {
      const remPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      // RainCode: a fold measured in lines opens on anything past those lines.
      const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight) || 1.5 * remPx;
      setTallEnough(
        foldLines
          ? content.offsetHeight > (foldLines + 0.5) * lineHeight
          : content.offsetHeight >= FOLDED_HEIGHT_REM * 2 * remPx,
      );
    };
    // Measured here too: waiting for the observer would paint one unfolded frame.
    measure();
    return observeResize(content, measure);
  }, [enabled, foldLines]);
  return { ref, tallEnough: enabled && tallEnough };
}
