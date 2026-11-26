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
    // The observer reports after the browser's own layout and flushes before paint, so the first
    // frame is already folded. Measuring here instead would force a layout mid-commit.
    return observeResize(content, (entries) => {
      const height = entries.at(-1)?.borderBoxSize[0]?.blockSize ?? content.offsetHeight;
      const remPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      // RainCode: a fold measured in lines opens on anything past those lines.
      const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight) || 1.5 * remPx;
      setTallEnough(
        foldLines
          ? height > (foldLines + 0.5) * lineHeight
          : height >= FOLDED_HEIGHT_REM * 2 * remPx,
      );
    });
  }, [enabled, foldLines]);
  return { ref, tallEnough: enabled && tallEnough };
}
