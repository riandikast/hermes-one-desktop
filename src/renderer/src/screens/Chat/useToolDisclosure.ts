import { useEffect, useState } from "react";
import { flushSync } from "react-dom";

const pending = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
function schedule(): void {
  if (timer !== undefined || !pending.size) return;
  timer = setTimeout(() => {
    timer = undefined;
    const next = pending.values().next().value;
    if (next) {
      pending.delete(next);
      // Commit one unit before yielding; React batching must not merge the queue.
      flushSync(next);
    }
    schedule();
  }, 0);
}

// ponytail: bounds mount breadth, not the cost of one unusually large result.
export function useToolDisclosure(open: boolean, total = 1, batch = 1): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!open) {
      setCount(0);
      return;
    }
    if (count >= total) return;
    const next = (): void =>
      setCount((value) => Math.min(value + batch, total));
    pending.add(next);
    schedule();
    return () => {
      pending.delete(next);
      if (!pending.size && timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
    };
  }, [open, count, total, batch]);
  return open ? Math.min(count, total) : 0;
}
