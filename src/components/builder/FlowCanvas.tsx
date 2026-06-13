import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
  type WheelEvent,
} from "react";
import {
  ReactFlow,
  Background,
  Controls,
  ReactFlowProvider,
  useReactFlow,
  type EdgeMouseHandler,
  type Node,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useBuilderStore } from "@/lib/builder/store";
import { NodeRenderers } from "./FlowNodes";
import type { FlowNodeData } from "@/lib/builder/types";

const KIND_COLOR: Record<string, string> = {
  conversation: "var(--flow-node)",
  function: "var(--flow-node)",
  call_transfer: "var(--flow-node)",
  agent_transfer: "var(--flow-node)",
  press_digit: "var(--flow-node)",
  logic_split: "var(--flow-node)",
  sms: "var(--flow-node)",
  extract_variable: "var(--flow-node)",
  code: "var(--flow-node)",
  ending: "var(--flow-node)",
  note: "var(--flow-node)",
  wa_start:   "var(--flow-node)",
  wa_message: "var(--flow-node)",
  wa_delay:   "var(--flow-node)",
  wa_media:   "var(--flow-node)",
};

const MINI_MAP_WIDTH = 132;
const MINI_MAP_HEIGHT = 88;
const MINI_MAP_PADDING = 6;

const NODE_DIMENSIONS: Record<string, { width: number; height: number }> = {
  ending: { width: 224, height: 110 },
  note: { width: 224, height: 110 },
};

function nodeColor(n: Node) {
  const kind = (n.data as FlowNodeData | undefined)?.kind ?? "conversation";
  return KIND_COLOR[kind] ?? KIND_COLOR.conversation;
}

function nodeDimensions(node: Node) {
  const measured = node.measured ?? {};
  const fallback = NODE_DIMENSIONS[(node.data as FlowNodeData | undefined)?.kind ?? ""] ?? {
    width: 288,
    height: 170,
  };
  return {
    width: typeof measured.width === "number" ? measured.width : fallback.width,
    height: typeof measured.height === "number" ? measured.height : fallback.height,
  };
}

function FlowMiniMap({
  nodes,
  viewport,
  canvasSize,
}: {
  nodes: Node[];
  viewport: Viewport;
  canvasSize: { width: number; height: number };
}) {
  const rf = useReactFlow();
  const draggingRef = useRef(false);

  const map = useMemo(() => {
    if (!nodes.length) return null;

    const paddedNodes = nodes.map((node) => {
      const dimensions = nodeDimensions(node);
      return {
        node,
        x: node.position.x,
        y: node.position.y,
        width: dimensions.width,
        height: dimensions.height,
      };
    });

    const minX = Math.min(...paddedNodes.map((n) => n.x));
    const minY = Math.min(...paddedNodes.map((n) => n.y));
    const maxX = Math.max(...paddedNodes.map((n) => n.x + n.width));
    const maxY = Math.max(...paddedNodes.map((n) => n.y + n.height));
    const width = Math.max(maxX - minX, 1);
    const height = Math.max(maxY - minY, 1);
    const scale = Math.min(
      (MINI_MAP_WIDTH - MINI_MAP_PADDING * 2) / width,
      (MINI_MAP_HEIGHT - MINI_MAP_PADDING * 2) / height,
    );
    const offsetX = (MINI_MAP_WIDTH - width * scale) / 2;
    const offsetY = (MINI_MAP_HEIGHT - height * scale) / 2;

    const toMiniX = (x: number) => offsetX + (x - minX) * scale;
    const toMiniY = (y: number) => offsetY + (y - minY) * scale;
    const toFlowX = (x: number) => minX + (x - offsetX) / scale;
    const toFlowY = (y: number) => minY + (y - offsetY) / scale;

    return { paddedNodes, scale, toMiniX, toMiniY, toFlowX, toFlowY };
  }, [nodes]);

  const viewportRect = useMemo(() => {
    if (!map || !canvasSize.width || !canvasSize.height || !viewport.zoom) return null;
    const flowX = -viewport.x / viewport.zoom;
    const flowY = -viewport.y / viewport.zoom;
    const flowWidth = canvasSize.width / viewport.zoom;
    const flowHeight = canvasSize.height / viewport.zoom;
    return {
      x: map.toMiniX(flowX),
      y: map.toMiniY(flowY),
      width: flowWidth * map.scale,
      height: flowHeight * map.scale,
    };
  }, [canvasSize.height, canvasSize.width, map, viewport.x, viewport.y, viewport.zoom]);

  const centerAtPointer = useCallback(
    (event: PointerEvent<SVGSVGElement>) => {
      if (!map) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - bounds.left;
      const y = event.clientY - bounds.top;
      rf.setCenter(map.toFlowX(x), map.toFlowY(y), {
        zoom: viewport.zoom,
        duration: 120,
      });
    },
    [map, rf, viewport.zoom],
  );

  const onPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    draggingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    centerAtPointer(event);
  };

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (draggingRef.current) centerAtPointer(event);
  };

  const onPointerUp = (event: PointerEvent<SVGSVGElement>) => {
    draggingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (event.deltaY < 0) {
      void rf.zoomIn({ duration: 120 });
    } else {
      void rf.zoomOut({ duration: 120 });
    }
  };

  if (!map) return null;

  return (
    <div className="nopan nodrag nowheel absolute bottom-3 right-3 z-20 hidden overflow-hidden rounded-md border border-white/[0.06] bg-background/70 shadow-[0_4px_20px_-8px_rgba(0,0,0,0.5)] backdrop-blur-md transition-opacity hover:opacity-100 opacity-70 md:block">
      <svg
        width={MINI_MAP_WIDTH}
        height={MINI_MAP_HEIGHT}
        viewBox={`0 0 ${MINI_MAP_WIDTH} ${MINI_MAP_HEIGHT}`}
        role="img"
        aria-label="Flow mini map"
        className="block cursor-crosshair"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        <rect width={MINI_MAP_WIDTH} height={MINI_MAP_HEIGHT} fill="var(--flow-minimap-bg)" />
        {map.paddedNodes.map(({ node, x, y, width, height }) => {
          const miniWidth = Math.max(width * map.scale, 5);
          const miniHeight = Math.max(height * map.scale, 5);
          return (
            <rect
              key={node.id}
              x={map.toMiniX(x)}
              y={map.toMiniY(y)}
              width={miniWidth}
              height={miniHeight}
              rx={2}
              fill={nodeColor(node)}
              stroke="var(--flow-minimap-node-stroke)"
              strokeWidth={1}
              opacity={0.95}
            />
          );
        })}
        {viewportRect && (
          <rect
            x={viewportRect.x}
            y={viewportRect.y}
            width={Math.max(viewportRect.width, 8)}
            height={Math.max(viewportRect.height, 8)}
            fill="var(--flow-minimap-viewport)"
            stroke="var(--flow-minimap-viewport-stroke)"
            strokeWidth={1.5}
          />
        )}
      </svg>
    </div>
  );
}

function CanvasInner({
  containerRef,
  onReady,
}: {
  containerRef: RefObject<HTMLDivElement | null>;
  onReady?: (rf: ReturnType<typeof useReactFlow>) => void;
}) {
  const rf = useReactFlow();
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const readyRef = useRef(false);
  useEffect(() => {
    if (!readyRef.current && onReady) {
      readyRef.current = true;
      onReady(rf);
    }
  }, [rf, onReady]);

  const { nodes, edges, onNodesChange, onEdgesChange, onConnect, deleteEdge, flowVersion } =
    useBuilderStore();

  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const updateSize = () => setCanvasSize({ width: node.clientWidth, height: node.clientHeight });
    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(node);
    return () => observer.disconnect();
  }, [containerRef]);

  // Re-fit the viewport whenever the graph is replaced (import / clear).
  useEffect(() => {
    const t = setTimeout(() => {
      rf.fitView({ padding: 0.4, maxZoom: 0.7, duration: 400 });
    }, 50);
    return () => clearTimeout(t);
  }, [flowVersion, rf]);

  const onEdgeClick: EdgeMouseHandler = (_, edge) => {
    if (confirm("Delete this connection?")) deleteEdge(edge.id);
  };

  const memoTypes = useMemo(() => NodeRenderers, []);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onEdgeClick={onEdgeClick}
      onMove={(_, nextViewport) => setViewport(nextViewport)}
      nodeTypes={memoTypes}
      fitView
      fitViewOptions={{ padding: 0.4, maxZoom: 0.7 }}
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{
        type: "smoothstep",
        animated: false,
        style: {
          stroke: "var(--flow-edge)",
          strokeWidth: 2,
          filter: "drop-shadow(0 0 6px rgba(110, 231, 249, 0.5))",
        },
      }}
    >
      <Background gap={20} size={1} color="var(--flow-grid)" />
      <Controls
        showInteractive={false}
        className="!bg-primary !text-primary-foreground !border-primary [&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:!border-primary/40 [&>button:hover]:!bg-primary/80"
      />
      <FlowMiniMap nodes={nodes} viewport={viewport} canvasSize={canvasSize} />
    </ReactFlow>
  );
}

export function FlowCanvas({
  canvasRef,
  onReady,
}: {
  canvasRef?: React.RefObject<HTMLDivElement | null>;
  onReady?: (rf: ReturnType<typeof useReactFlow>) => void;
}) {
  const internalRef = useRef<HTMLDivElement>(null);
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      internalRef.current = node;
      if (canvasRef) canvasRef.current = node;
    },
    [canvasRef],
  );

  return (
    <div ref={setRefs} className="h-full w-full bg-[var(--flow-canvas)]">
      <ReactFlowProvider>
        <CanvasInner containerRef={internalRef} onReady={onReady} />
      </ReactFlowProvider>
    </div>
  );
}
