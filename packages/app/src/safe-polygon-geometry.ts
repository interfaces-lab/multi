// Mirror of Base UI's `safePolygon` hover-intent math (floating-ui-react/safePolygon.mjs,
// sides "right" and "left"). Base UI computes these zones privately on every mousemove and
// does not expose them, so this module recomputes them from the same inputs: the pointer
// position captured when it leaves the trigger, the trigger rect, and the floating popup
// rect. Used by the composer model selector's panel-hold logic and drawn live by the
// /demo/model-menu page.

type Point = { readonly x: number; readonly y: number };

type Rect = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
};

type SafeZone = {
  /** Quadrilateral from the pointer exit point to the floating popup's near edge. */
  readonly polygon: readonly [Point, Point, Point, Point];
  /** Rectangular trough between the trigger and the popup that always stays safe. */
  readonly trough: Rect;
};

/** Which side of the trigger the floating popup sits on. */
type SafeZoneSide = "left" | "right";

// Constants lifted verbatim from Base UI 1.6.0. Together they are the "overhead" a hover
// traversal is granted before the submenu closes.
const SAFE_POLYGON_BUFFER_PX = 0.5;
/** Once the pointer leaves the trigger, staying inside the polygon buys 40ms per move. */
const SAFE_POLYGON_GRACE_MS = 40;
/** Below this speed the pointer counts as "resting", and resting outside closes. */
const SLOW_CURSOR_THRESHOLD_PX_PER_MS = 0.1;
/** `MenuSubmenuTrigger` default `delay`: the pointer must rest this long to open. */
const SUBMENU_HOVER_OPEN_REST_MS = 100;
/** `@honk/ui` PreviewCard.Trigger open delay (deliberate override of Base UI's 600ms). */
const PREVIEW_HOVER_OPEN_DELAY_MS = 400;
/** Base UI PreviewCard `CLOSE_DELAY`: the panel lingers this long after pointer exit. */
const PREVIEW_HOVER_CLOSE_DELAY_MS = 300;

function rectHeight(rect: Rect): number {
  return rect.bottom - rect.top;
}

// Base UI's side === "right" and side === "left" branches: the polygon apex is the exit
// point and the base is the floating popup's near edge (left edge for a popup on the
// right, right edge for a popup on the left).
function computeSafeZone(
  exit: Point,
  triggerRect: Rect,
  floatingRect: Rect,
  side: SafeZoneSide = "right",
): SafeZone {
  const rect = floatingRect;
  const refRect = triggerRect;
  const cursorLeaveFromBottom = exit.y > rect.bottom - rectHeight(rect) / 2;
  const floatingTaller = rectHeight(rect) > rectHeight(refRect);

  const cursorYOffset = floatingTaller ? SAFE_POLYGON_BUFFER_PX / 2 : SAFE_POLYGON_BUFFER_PX * 4;
  const cursorPointOneY = floatingTaller
    ? exit.y + cursorYOffset
    : cursorLeaveFromBottom
      ? exit.y + cursorYOffset
      : exit.y - cursorYOffset;
  const cursorPointTwoY = floatingTaller
    ? exit.y - cursorYOffset
    : cursorLeaveFromBottom
      ? exit.y + cursorYOffset
      : exit.y - cursorYOffset;

  let polygon: readonly [Point, Point, Point, Point];
  if (side === "right") {
    const cursorPointX = exit.x - SAFE_POLYGON_BUFFER_PX;
    const commonXTop = cursorLeaveFromBottom
      ? rect.left + SAFE_POLYGON_BUFFER_PX
      : floatingTaller
        ? rect.left + SAFE_POLYGON_BUFFER_PX
        : rect.right;
    const commonXBottom = cursorLeaveFromBottom
      ? floatingTaller
        ? rect.left + SAFE_POLYGON_BUFFER_PX
        : rect.right
      : rect.left + SAFE_POLYGON_BUFFER_PX;
    polygon = [
      { x: cursorPointX, y: cursorPointOneY },
      { x: cursorPointX, y: cursorPointTwoY },
      { x: commonXTop, y: rect.top },
      { x: commonXBottom, y: rect.bottom },
    ];
  } else {
    const cursorPointX = exit.x + SAFE_POLYGON_BUFFER_PX + 1;
    const commonXTop = cursorLeaveFromBottom
      ? rect.right - SAFE_POLYGON_BUFFER_PX
      : floatingTaller
        ? rect.right - SAFE_POLYGON_BUFFER_PX
        : rect.left;
    const commonXBottom = cursorLeaveFromBottom
      ? floatingTaller
        ? rect.right - SAFE_POLYGON_BUFFER_PX
        : rect.left
      : rect.right - SAFE_POLYGON_BUFFER_PX;
    polygon = [
      { x: commonXTop, y: rect.top },
      { x: commonXBottom, y: rect.bottom },
      { x: cursorPointX, y: cursorPointOneY },
      { x: cursorPointX, y: cursorPointTwoY },
    ];
  }

  // The trough is clamped to the shorter element's vertical extent.
  const troughTop = (floatingTaller ? refRect : rect).top;
  const troughBottom = (floatingTaller ? refRect : rect).bottom;
  const trough: Rect =
    side === "right"
      ? { left: refRect.right - 1, right: rect.left + 1, top: troughTop, bottom: troughBottom }
      : { left: rect.right - 1, right: refRect.left + 1, top: troughTop, bottom: troughBottom };

  return { polygon, trough };
}

// Ray-casting test, identical in effect to Base UI's `isPointInQuadrilateral`.
function isPointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (a === undefined || b === undefined) continue;
    const intersects =
      a.y >= point.y !== b.y >= point.y &&
      point.x <= ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

function isPointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x >= Math.min(rect.left, rect.right) &&
    point.x <= Math.max(rect.left, rect.right) &&
    point.y >= Math.min(rect.top, rect.bottom) &&
    point.y <= Math.max(rect.top, rect.bottom)
  );
}

function isPointInSafeZone(point: Point, zone: SafeZone): boolean {
  return isPointInRect(point, zone.trough) || isPointInPolygon(point, zone.polygon);
}

export {
  computeSafeZone,
  isPointInPolygon,
  isPointInRect,
  isPointInSafeZone,
  PREVIEW_HOVER_CLOSE_DELAY_MS,
  PREVIEW_HOVER_OPEN_DELAY_MS,
  SAFE_POLYGON_BUFFER_PX,
  SAFE_POLYGON_GRACE_MS,
  SLOW_CURSOR_THRESHOLD_PX_PER_MS,
  SUBMENU_HOVER_OPEN_REST_MS,
};
export type { Point, Rect, SafeZone, SafeZoneSide };
