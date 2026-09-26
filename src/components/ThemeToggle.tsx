import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle({ className }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const transitioning = useRef(false);

  useEffect(() => {
    setMounted(true);
    setTheme(document.documentElement.classList.contains("dark") ? "dark" : "light");
  }, []);

  const toggleTheme = () => {
    if (!mounted || transitioning.current) return;
    const root = document.documentElement;
    const next = root.classList.contains("dark") ? "light" : "dark";
    const applyTheme = () => {
      root.classList.toggle("dark", next === "dark");
      flushSync(() => setTheme(next));
      try {
        localStorage.setItem("theme", next);
      } catch {}
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      applyTheme();
      return;
    }

    transitioning.current = true;
    const finish = () => {
      root.classList.remove("theme-crossfade", "theme-color-transition");
      transitioning.current = false;
    };
    // Snapshot crossfade includes gradients and icons without animating layout.
    const transitionDocument = document as Document & {
      startViewTransition?: (update: () => void) => { finished: Promise<void> };
    };
    if (transitionDocument.startViewTransition) {
      root.classList.add("theme-crossfade");
      try {
        const transition = transitionDocument.startViewTransition(applyTheme);
        void transition.finished.then(finish, finish);
      } catch {
        applyTheme();
        finish();
      }
    } else {
      root.classList.add("theme-color-transition");
      // Establish the transition rule before changing the theme values.
      void root.offsetWidth;
      applyTheme();
      window.setTimeout(finish, 300);
    }
  };

  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Toggle theme"
      className={className}
      onClick={toggleTheme}
    >
      {!mounted ? (
        <Sun className="h-4 w-4" />
      ) : theme === "dark" ? (
        <Sun className="h-4 w-4" />
      ) : (
        <Moon className="h-4 w-4" />
      )}
    </Button>
  );
}
