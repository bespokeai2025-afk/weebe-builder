import { memo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  Position,
  getSmoothStepPath,
  type EdgeProps,
} from "@xyflow/react";
import { X } from "lucide-react";
import { useBuilderStore } from "@/lib/builder/store";

const CORNER = 16;
const HANDLE_STUB = 20;
/** Horizontal run out of the source before the first rounded turn (Retell hub fan). */
const FIRST_BEND = 44;

/**
 * Retell conversation-flow edges: orthogonal (H/V) with rounded corners.
 * Leave the handle horizontally, turn, run vertically to the target row, turn
 * again, enter the target from the left. Stacked transitions stagger their
 * riser so they stay parallel instead of collapsing onto one trunk.
 */
export function retellEdgePath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
  sourcePosition: Position = Position.Right,
  targetPosition: Position = Position.Left,
): [string, number, number] {
  const dx = targetX - sourceX;
  const dy = targetY - sourceY;
  const backward = dx < -12;

  const params: Parameters<typeof getSmoothStepPath>[0] = {
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: CORNER,
    offset: HANDLE_STUB,
  };

  if (backward && Math.abs(dy) < 24) {
    params.centerY = sourceY + Math.max(72, Math.abs(dx) * 0.12);
  } else if (!backward && Math.abs(dy) >= 12) {
    const stagger = (Math.round(sourceY / 18) % 6) * 10;
    const centerX = sourceX + FIRST_BEND + stagger;
    if (centerX < targetX - 28) params.centerX = centerX;
  }

  const [path, labelX, labelY] = getSmoothStepPath(params);
  return [path, labelX, labelY];
}

function FlowDeletableEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const deleteEdge = useBuilderStore((s) => s.deleteEdge);
  const [hovered, setHovered] = useState(false);
  const [path, labelX, labelY] = retellEdgePath(
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  );
  const showRemove = hovered || selected;

  return (
    <>
      <path
        d={path}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        className="react-flow__edge-interaction"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan pointer-events-auto absolute"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          <button
            type="button"
            aria-label="Remove connection"
            title="Remove connection"
            onClick={(e) => {
              e.stopPropagation();
              deleteEdge(id);
            }}
            className={
              showRemove
                ? "flex h-6 w-6 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-sm hover:border-rose-400 hover:text-rose-600"
                : "pointer-events-none h-6 w-6 opacity-0"
            }
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const FlowDeletableEdge = memo(FlowDeletableEdgeInner);
