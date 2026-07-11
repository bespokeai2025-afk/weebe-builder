/**
 * webuyanyhouse (WBAH) is a UK business. All of its timestamps are stored in
 * UTC in the database, but should always be *displayed* in UK local time
 * (GMT/BST, auto-adjusting for daylight saving) regardless of the viewer's
 * or server's own timezone — never in the browser/server default (e.g. the
 * PDT default some environments fall back to).
 *
 * This must ONLY be applied to WBAH-scoped views — other workspaces should
 * keep using the viewer's local timezone (`undefined`) as before.
 */
export const WBAH_TIMEZONE = "Europe/London";

/** Merge a `timeZone: "Europe/London"` override into Intl options, only when `isWbah` is true. */
export function wbahDateTimeOptions(
  isWbah: boolean,
  opts: Intl.DateTimeFormatOptions = {},
): Intl.DateTimeFormatOptions {
  return isWbah ? { ...opts, timeZone: WBAH_TIMEZONE } : opts;
}
