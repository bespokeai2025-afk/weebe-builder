import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Routes render inside Suspense, where React Query v5 defaults
        // throwOnError to true — a single failing query (e.g. an expired
        // session) would retry ~3 times (~10-15s) and then blow the whole
        // page away with the root error screen. Never let a data fetch
        // crash the app; components surface their own error states.
        throwOnError: false,
        retry: 2,
        // React Query's default is 0 — every mount, route change and tab refocus re-ran every
        // query on screen. 30s keeps navigation and refocus instant; pages that need fresher
        // data set their own staleTime / refetchInterval, and mutations still invalidate.
        staleTime: 30_000,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
