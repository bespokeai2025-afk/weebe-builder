/**
 * TanStack Start type-checks every server-function result as serializable, and `unknown` (as in
 * `Record<string, unknown>` payloads straight from jsonb columns) fails that check: the handler
 * errors and every caller gets an untyped `unknown` result back.
 *
 * `jsonResult(handler)` is a compile-time-only wrapper that re-types those `unknown`s as `any` —
 * untyped JSON once they cross the wire, which is how the UI reads them — and leaves everything
 * else (functions, class instances, …) to the serializability check:
 *
 *   .handler(jsonResult(async ({ data, context }) => loadThing(data.id)))
 */
export type Jsonish<T> = unknown extends T
  ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
    any
  : T extends Date
    ? T
    : T extends ReadonlyArray<infer U>
      ? Jsonish<U>[]
      : T extends object
        ? { [K in keyof T]: Jsonish<T[K]> }
        : T;

export function jsonResult<A extends unknown[], R>(
  handler: (...args: A) => Promise<R>,
): (...args: A) => Promise<Jsonish<R>> {
  return handler as (...args: A) => Promise<Jsonish<R>>;
}
