import { useEffect, useState, type RefObject } from "react";

/** Pause WebGL when the hero scrolls off-screen (Aura-style perf guard). */
export function useInView(ref: RefObject<Element | null>, rootMargin = "120px") {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin, threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return visible;
}
