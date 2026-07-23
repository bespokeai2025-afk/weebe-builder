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

function reportClientError(error: Error) {
  try {
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
    // Inline bootstrap scripts rendered via HeadContent (not raw JSX in the
    // shell) so hydration tolerates scripts injected into <head> by the Replit
    // dev preview / browser extensions. Raw positional <script> JSX in <head>
    // pairs against injected tags and crashes hydration.
    scripts: [
      { children: themeInitScript },
      { children: errorReportScript },
      { children: chunkReloadScript },
      { children: swCleanupScript },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

const themeInitScript = `(function(){try{var t=localStorage.getItem('theme');var d=t?t==='dark':true;document.documentElement.classList.toggle('dark',d);}catch(e){document.documentElement.classList.add('dark');}})();`;

// After a republish, browsers holding the previous build's HTML/JS request old
// hashed chunks (e.g. assets/builder-XXXX.js) that no longer exist → 404 → the
// route (e.g. /builder) never loads. Vite fires "vite:preloadError" when a
// dynamic chunk import fails; reload once (timestamp-guarded, max once/20s) so
// the browser picks up the fresh build instead of showing a dead page.
const chunkReloadScript = `(function(){function guard(){try{var k='chunk-autoreload-ts';var last=parseInt(sessionStorage.getItem(k)||'0',10);if(Date.now()-last>20000){sessionStorage.setItem(k,String(Date.now()));var u=new URL(window.location.href);u.searchParams.set('_v',String(Date.now()));window.location.replace(u.toString());return true;}}catch(e){}return false;}window.addEventListener('vite:preloadError',function(e){if(guard()&&e&&e.preventDefault)e.preventDefault();});window.addEventListener('error',function(e){var m=(e&&e.message)||'';if(/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading (CSS )?chunk|Invalid server function|Unexpected token '<'|is not valid JSON|Unexpected end of JSON|MIME type/i.test(m))guard();},true);window.addEventListener('unhandledrejection',function(e){var m=String((e&&e.reason&&e.reason.message)||e.reason||'');if(/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading (CSS )?chunk|Invalid server function|Unexpected token '<'|is not valid JSON|Unexpected end of JSON|MIME type/i.test(m))guard();});})();`;

// Some browsers hold a stale service worker / CacheStorage from an earlier
// build of this domain, which keeps serving months-old JS and crashes with
// errors (e.g. "Illegal constructor") no current code produces. Unregister any
// service workers and purge caches once per session so those browsers recover.
const swCleanupScript = `(function(){try{if(sessionStorage.getItem('sw-cleanup-done'))return;sessionStorage.setItem('sw-cleanup-done','1');}catch(e){}try{if(navigator.serviceWorker&&navigator.serviceWorker.getRegistrations){navigator.serviceWorker.getRegistrations().then(function(rs){var had=rs.length>0;rs.forEach(function(r){r.unregister();});if(had)setTimeout(function(){window.location.reload();},400);}).catch(function(){});}}catch(e){}try{if(window.caches&&caches.keys){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k);});}).catch(function(){});}}catch(e){}})();`;

// Report the FIRST uncaught error per page load to the server so production
// crashes leave a stack trace in the deployment logs.
const errorReportScript = `(function(){var sent=false;function rep(msg,stack){if(sent)return;sent=true;try{fetch('/api/monitoring/client-error',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:String(msg||'').slice(0,500),stack:String(stack||'').slice(0,2000),url:window.location.href}),keepalive:true}).catch(function(){});}catch(e){}}window.addEventListener('error',function(e){var er=e&&e.error;rep((er&&er.message)||e.message,er&&er.stack);},true);window.addEventListener('unhandledrejection',function(e){var r=e&&e.reason;rep((r&&r.message)||String(r),r&&r.stack);});})();`;

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
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
