// Bootstrap script served as a static file so the React-rendered <head>
// contains NO inline <script> tags. Inline scripts hydrate positionally, and
// scripts injected into <head> by the Replit dev preview / browser extensions
// pair against them and crash hydration ("Hydration failed" + "Invalid hook
// call" on every page). An external async script is a hoistable resource in
// React 19 — matched by URL, not position — so injected tags can't break it.
//
// Sections: theme init, first-error reporter, stale-build auto-reload,
// stale service-worker cleanup.
(function () {
  // ---- Theme init -------------------------------------------------------
  // The SSR shell renders <html class="dark"> (dark is the default), so this
  // only needs to REMOVE the class for users who chose light mode.
  try {
    var t = localStorage.getItem("theme");
    var dark = t ? t === "dark" : true;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {
    document.documentElement.classList.add("dark");
  }

  // ---- Report the FIRST uncaught error per page load --------------------
  // so production crashes leave a stack trace in the deployment logs.
  // Recovered hydration errors are excluded (they'd trigger false alerts).
  var sent = false;
  var skip = /Hydration failed|error while hydrating|hydration mismatch|Invalid hook call/i;
  function rep(msg, stack) {
    if (sent) return;
    if (skip.test(String(msg || ""))) return;
    sent = true;
    try {
      fetch("/api/monitoring/client-error", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: String(msg || "").slice(0, 500),
          stack: String(stack || "").slice(0, 2000),
          url: window.location.href,
        }),
        keepalive: true,
      }).catch(function () {});
    } catch (e) {}
  }
  window.addEventListener(
    "error",
    function (e) {
      var er = e && e.error;
      rep((er && er.message) || e.message, er && er.stack);
    },
    true
  );
  window.addEventListener("unhandledrejection", function (e) {
    var r = e && e.reason;
    rep((r && r.message) || String(r), r && r.stack);
  });

  // ---- Stale-build auto-reload ------------------------------------------
  // After a republish, browsers holding the previous build's HTML/JS request
  // old hashed chunks that 404. Reload once (timestamp-guarded, max once/20s)
  // so the browser picks up the fresh build instead of showing a dead page.
  var STALE_RE =
    /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading (CSS )?chunk|Invalid server function|Unexpected token '<'|is not valid JSON|Unexpected end of JSON|MIME type/i;
  function guard() {
    try {
      var k = "chunk-autoreload-ts";
      var last = parseInt(sessionStorage.getItem(k) || "0", 10);
      if (Date.now() - last > 20000) {
        sessionStorage.setItem(k, String(Date.now()));
        var u = new URL(window.location.href);
        u.searchParams.set("_v", String(Date.now()));
        window.location.replace(u.toString());
        return true;
      }
    } catch (e) {}
    return false;
  }
  window.addEventListener("vite:preloadError", function (e) {
    if (guard() && e && e.preventDefault) e.preventDefault();
  });
  window.addEventListener(
    "error",
    function (e) {
      var m = (e && e.message) || "";
      if (STALE_RE.test(m)) guard();
    },
    true
  );
  window.addEventListener("unhandledrejection", function (e) {
    var m = String((e && e.reason && e.reason.message) || e.reason || "");
    if (STALE_RE.test(m)) guard();
  });

  // ---- Stale service-worker cleanup --------------------------------------
  // Some browsers hold a stale service worker / CacheStorage from an earlier
  // build of this domain, which keeps serving months-old JS. Unregister any
  // service workers and purge caches once per session so those browsers
  // recover.
  try {
    if (!sessionStorage.getItem("sw-cleanup-done")) {
      sessionStorage.setItem("sw-cleanup-done", "1");
      try {
        if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
          navigator.serviceWorker
            .getRegistrations()
            .then(function (rs) {
              var had = rs.length > 0;
              rs.forEach(function (r) {
                r.unregister();
              });
              if (had)
                setTimeout(function () {
                  window.location.reload();
                }, 400);
            })
            .catch(function () {});
        }
      } catch (e) {}
      try {
        if (window.caches && caches.keys) {
          caches
            .keys()
            .then(function (ks) {
              ks.forEach(function (k) {
                caches.delete(k);
              });
            })
            .catch(function () {});
        }
      } catch (e) {}
    }
  } catch (e) {}
})();
