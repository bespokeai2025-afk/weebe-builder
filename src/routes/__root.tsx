import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { Toaster } from "@/components/ui/sonner";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

// Errors that mean the browser is running a previous build (chunks/server-fn
// IDs from before a republish). A hard reload fetches the fresh build.
const STALE_BUILD_RE =
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading (CSS )?chunk|Invalid server function|Unexpected token '<'|is not valid JSON|Unexpected end of JSON|MIME type/i;

function hardReloadForStaleBuild(): boolean {
  try {
    const k = "chunk-autoreload-ts";
    const last = parseInt(sessionStorage.getItem(k) || "0", 10);
    if (Date.now() - last > 20000) {
      sessionStorage.setItem(k, String(Date.now()));
      const url = new URL(window.location.href);
      url.searchParams.set("_v", String(Date.now()));
      window.location.replace(url.toString());
      return true;
    }
  } catch {}
  return false;
}

function autoReloadOnce(): boolean {
  return hardReloadForStaleBuild();
}

// Hydration mismatches are recovered automatically by React (it regenerates
// the tree on the client), and in the Replit dev preview they are routinely
// caused by scripts injected into <head> from outside the app. Reporting them
// as crashes floods the monitoring log and triggers false "app crashed"
// alerts, so they are excluded from crash reporting. All other errors still
// get reported.
const RECOVERABLE_HYDRATION_RE =
  /Hydration failed|error while hydrating|hydration mismatch|Invalid hook call/i;

function reportClientError(error: Error) {
  try {
    const msg = `${error?.message ?? ""}`;
    if (RECOVERABLE_HYDRATION_RE.test(msg)) return;
    const key = "client-error-reported-ts";
    const last = parseInt(sessionStorage.getItem(key) || "0", 10);
    if (Date.now() - last < 5000) return;
    sessionStorage.setItem(key, String(Date.now()));
    fetch("/api/monitoring/client-error", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: error?.message ?? String(error),
        stack: (error as any)?.stack ?? "",
        url: window.location.href,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  if (typeof window !== "undefined") reportClientError(error);

  // IMPORTANT: no hooks in this component. It renders in error-recovery
  // contexts where React hooks can be invalid ("Invalid hook call") — a hook
  // here would crash the error page itself and kill the auto-reload.
  const msg = `${error?.message ?? ""} ${(error as any)?.stack ?? ""}`;
  const isStale = typeof window !== "undefined" && STALE_BUILD_RE.test(msg);

  // Any render/route error gets ONE automatic hard reload (20s guard in
  // autoReloadOnce). Stale-deploy errors are always fixed by this; transient
  // hydration/render errors usually are too. If it recurs within 20s we fall
  // through and show the error screen with diagnostics.
  if (typeof window !== "undefined") {
    const k = "chunk-autoreload-ts";
    let last = 0;
    try {
      last = parseInt(sessionStorage.getItem(k) || "0", 10);
    } catch {}
    if (Date.now() - last > 20000) {
      setTimeout(() => autoReloadOnce(), 250);
      return (
        <div className="flex min-h-screen items-center justify-center bg-background px-4">
          <p className="text-sm text-muted-foreground">
            {isStale ? "Updating to the latest version…" : "Reloading…"}
          </p>
        </div>
      );
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        {error?.message ? (
          <p className="mt-3 break-words rounded-md bg-muted px-3 py-2 text-left text-xs text-muted-foreground">
            {String(error.message).slice(0, 300)}
          </p>
        ) : null}
        {isStale ? (
          <p className="mt-2 text-xs text-amber-500/90">
            A new version was deployed — reloading should fix this. If it persists, hard-refresh
            (Ctrl+Shift+R) or open in a private window.
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              try {
                const url = new URL(window.location.href);
                url.searchParams.set("_v", String(Date.now()));
                window.location.replace(url.toString());
              } catch {
                reset();
              }
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lovable App" },
      {
        name: "description",
        content: "Export conversation flows as dashboard-compatible JSON for agent creation.",
      },
      { name: "author", content: "Lovable" },
      { property: "og:title", content: "Lovable App" },
      {
        property: "og:description",
        content: "Export conversation flows as dashboard-compatible JSON for agent creation.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:site", content: "@Lovable" },
      { name: "twitter:title", content: "Lovable App" },
      {
        name: "twitter:description",
        content: "Export conversation flows as dashboard-compatible JSON for agent creation.",
      },
      {
        property: "og:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/gR69ROSIkVYK3qlYWX1VlaPJwNc2/social-images/social-1779544291750-Gemini_Generated_Image_f5vae4f5vae4f5va_(2).webp",
      },
      {
        name: "twitter:image",
        content:
          "https://storage.googleapis.com/gpt-engineer-file-uploads/gR69ROSIkVYK3qlYWX1VlaPJwNc2/social-images/social-1779544291750-Gemini_Generated_Image_f5vae4f5vae4f5va_(2).webp",
      },
    ],
    links: [
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico?v=2" },
      { rel: "icon", type: "image/png", sizes: "512x512", href: "/favicon.png?v=2" },
      { rel: "apple-touch-icon", sizes: "180x180", href: "/apple-touch-icon.png?v=2" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
      },
      {
        rel: "stylesheet",
        href: appCss,
      },
    ],
    // Bootstrap logic (theme init, error reporter, stale-build reload, SW
    // cleanup) lives in the external /bootstrap.js static file — NOT inline
    // <script> children. Inline scripts hydrate positionally, so scripts
    // injected into <head> by the Replit dev preview / browser extensions
    // pair against them and crash hydration ("Hydration failed" + "Invalid
    // hook call" on every page load). An async external script is a React 19
    // hoistable resource matched by URL, immune to injected tags. Dark theme
    // still applies before paint because the shell renders
    // <html class="dark"> (the default) server-side.
    scripts: [{ src: "/bootstrap.js?v=1", async: true }],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  // className="dark" server-side so dark mode (the default) applies before
  // /bootstrap.js runs; the script removes the class for light-mode users.
  // suppressHydrationWarning tolerates the class differing at hydration time.
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster position="bottom-right" richColors />
    </QueryClientProvider>
  );
}
