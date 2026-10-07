import { useEffect, useState } from "react";
import logoWebeeDark from "@/assets/webee-logo-dark.png";
import logoLight from "@/assets/logo-light.webp";
import { cn } from "@/lib/utils";

export function Logo({ className }: { className?: string }) {
  const [isDark, setIsDark] = useState(true);

  useEffect(() => {
    const update = () => setIsDark(document.documentElement.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return (
    <img
      src={isDark ? logoWebeeDark : logoLight}
      alt="Webee"
      className={cn("h-10 w-auto select-none", className)}
      draggable={false}
    />
  );
}
