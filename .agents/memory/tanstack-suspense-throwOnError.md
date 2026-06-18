---
name: TanStack Router Suspense + throwOnError
description: Why useQuery inside TanStack Router routes throws errors to error boundaries instead of storing them in error state, and the correct fix pattern.
---

# TanStack Router forces throwOnError: true inside Suspense

## The rule
Every route component rendered by TanStack Router is wrapped in a React
Suspense boundary. React Query v5 detects this and **silently defaults
`throwOnError` to `true`** for any `useQuery` inside it. This means a
failed queryFn (e.g. stale server-fn ID returning `{}`) is **re-thrown**
to the nearest error boundary (TanStack's `CatchBoundaryImpl`) instead of
being stored in the `error` state of the query.

**Why:** React Query v5 changelog decision — inside Suspense, errors should
surface to the error boundary by default so they can be retried via Suspense
error boundaries. The existing behaviour in v4 was to swallow them, which
caused silent failures.

## How to apply
Add `throwOnError: false` explicitly to **every** `useQuery` in a routed
component when you want to handle errors yourself (e.g. show an inline
message, auto-reload, etc.):

```ts
const { data, error } = useQuery({
  queryKey: [...],
  queryFn: () => myServerFn(),
  throwOnError: false,   // ← mandatory in TanStack Router routes
  retry: 0,
});
```

Then add a `useEffect` to act on the `error` state:

```ts
useEffect(() => {
  if (error) {
    // e.g. auto-reload with timestamp guard
    const key = "page-autoreload-ts";
    const last = parseInt(sessionStorage.getItem(key) ?? "0");
    if (Date.now() - last > 20_000) {
      sessionStorage.setItem(key, String(Date.now()));
      window.location.reload();
    }
  }
}, [error]);
```

## Auto-reload guard pattern
Use **timestamp** in sessionStorage (not a boolean flag). Boolean flags get
stuck permanently after the first reload and prevent recovery if the first
reload also fails:

```ts
// WRONG — gets stuck after first reload
if (!sessionStorage.getItem("key")) {
  sessionStorage.setItem("key", "1");
  window.location.reload();
}

// CORRECT — allows retry after 20 seconds
const last = parseInt(sessionStorage.getItem("key") ?? "0");
if (Date.now() - last > 20_000) {
  sessionStorage.setItem("key", String(Date.now()));
  window.location.reload();
}
```

## Class-based error boundary for render-time throws
If a component can throw **during render** (before any `useEffect` runs),
add a class-based error boundary wrapping it. `useEffect` never runs if the
component throws before mounting:

```tsx
class AutoReloadBoundary extends Component<{children: ReactNode}, {hasError: boolean}> {
  state = { hasError: false };
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch() {
    if (typeof sessionStorage === "undefined") return;
    const key = "boundary-autoreload-ts";
    const last = parseInt(sessionStorage.getItem(key) ?? "0");
    if (Date.now() - last > 20_000) {
      sessionStorage.setItem(key, String(Date.now()));
      setTimeout(() => window.location.reload(), 300);
    }
  }
  render() {
    if (this.state.hasError) return <LoadingSpinner />;
    return this.props.children;
  }
}
```

## Root cause in this project
Stale TanStack server-fn IDs (after server restart without browser hard-refresh)
cause queryFn to return/throw `{}`. With the default `throwOnError: true`
(Suspense context), this crashes the entire route. Fix: always add
`throwOnError: false` to queries in route components.
