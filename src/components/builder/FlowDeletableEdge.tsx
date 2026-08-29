import { memo, useState } from "react";
import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from "@xyflow/react";
import { X } from "lucide-react";
import { useBuilderStore } from "@/lib/builder/store";

function steppedPath(
  sourceX: number,
  sourceY: number,
  targetX: number,
  targetY: number,
): [string, number, number] {
  const midX = sourceX + Math.max(24, (targetX - sourceX) / 2);
  const path = `M ${sourceX},${sourceY} L ${midX},${sourceY} L ${midX},${targetY} L ${targetX},${targetY}`;
  return [path, midX, (sourceY + targetY) / 2];
}

function FlowDeletableEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const deleteEdge = useBuilderStore((s) => s.deleteEdge);
  const [hovered, setHovered] = useState(false);
  const [path, labelX, labelY] = steppedPath(sourceX, sourceY, targetX, targetY);
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
