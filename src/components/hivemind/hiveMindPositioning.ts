export const HIVE_MIND_SHELL_GUTTER = 32;
export const HIVE_MIND_POSITION_VERSION = 3;
const VISIBLE_GUTTER = 16;

export type HiveMindDragOffset = { x: number; y: number };

export type HiveMindRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/**
 * Decorative application backdrops often use `fixed inset-0`. They are not
 * controls and must never reserve the lower-right workspace for HiveMind.
 */
export function isFullViewportBackground(
  rect: HiveMindRect,
  viewportWidth: number,
  viewportHeight: number,
) {
  const tolerance = 2;
  return (
    rect.left <= tolerance &&
    rect.top <= tolerance &&
    rect.right >= viewportWidth - tolerance &&
    rect.bottom >= viewportHeight - tolerance
  );
}

export function parseHiveMindDragOffset(raw: string | null): HiveMindDragOffset | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed?.version !== HIVE_MIND_POSITION_VERSION ||
      !Number.isFinite(parsed?.offset?.x) ||
      !Number.isFinite(parsed?.offset?.y)
    ) {
      return null;
    }
    return { x: parsed.offset.x, y: parsed.offset.y };
  } catch {
    return null;
  }
}

export type HiveMindAnchorInput = {
  viewportWidth: number;
  viewportHeight: number;
  mainLeft: number;
  mainRight: number;
  mainTop: number;
  orbWidth: number;
  orbHeight: number;
  rightReserve: number;
  bottomReserve: number;
  cornerBottomReserve: number;
};

export type HiveMindAnchor = {
  right: number;
  bottom: number;
  maxRight: number;
  maxBottom: number;
  stacksAboveCorner: boolean;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Keeps HiveMind within the visible main-content area even when a bottom-right
 * widget is too wide to fit beside it. In that case, it stacks above the widget
 * rather than treating an off-screen horizontal reserve as a valid anchor.
 */
export function calculateHiveMindAnchor(input: HiveMindAnchorInput): HiveMindAnchor {
  const maxRight = Math.max(
    VISIBLE_GUTTER,
    input.viewportWidth - Math.max(0, input.mainLeft) - input.orbWidth - VISIBLE_GUTTER,
  );
  const maxBottom = Math.max(
    VISIBLE_GUTTER,
    input.viewportHeight - Math.max(0, input.mainTop) - input.orbHeight - VISIBLE_GUTTER,
  );
  const shellRight = Math.max(
    HIVE_MIND_SHELL_GUTTER + input.viewportWidth - input.mainRight,
    VISIBLE_GUTTER,
  );
  const requestedRight = Math.max(shellRight, input.rightReserve);
  const stacksAboveCorner =
    requestedRight > maxRight &&
    input.cornerBottomReserve > 0;

  return {
    right: clamp(stacksAboveCorner ? shellRight : requestedRight, VISIBLE_GUTTER, maxRight),
    bottom: clamp(
      Math.max(
        HIVE_MIND_SHELL_GUTTER,
        input.bottomReserve,
        stacksAboveCorner ? input.cornerBottomReserve : 0,
      ),
      VISIBLE_GUTTER,
      maxBottom,
    ),
    maxRight,
    maxBottom,
    stacksAboveCorner,
  };
}