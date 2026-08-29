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
  type Connection,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useBuilderStore } from "@/lib/builder/store";
import { NodeRenderers } from "./FlowNodes";
import { FlowDeletableEdge } from "./FlowDeletableEdge";
import type { FlowNodeData } from "@/lib/builder/types";
import { validateFlow } from "@/lib/builder/validate";
import { isEditableHotkeyTarget } from "@/lib/builder/graph-ops";
import { NodeIssueContext, issueMapFromList } from "./flow-validation-context";
import { toast } from "sonner";

const KIND_COLOR: Record<string, string> = {
  conversation: "var(--flow-minimap-node-fill)",
  begin: "var(--flow-minimap-node-fill)",
  wait: "var(--flow-minimap-node-fill)",
  subagent: "var(--flow-minimap-node-fill)",
  mcp: "var(--flow-minimap-node-fill)",
  function: "var(--flow-minimap-node-fill)",
  call_transfer: "var(--flow-minimap-node-fill)",
  agent_transfer: "var(--flow-minimap-node-fill)",
  press_digit: "var(--flow-minimap-node-fill)",
  logic_split: "var(--flow-minimap-node-fill)",
  sms: "var(--flow-minimap-node-fill)",
  extract_variable: "var(--flow-minimap-node-fill)",
  code: "var(--flow-minimap-node-fill)",
  ending: "var(--flow-minimap-node-fill)",
  note: "var(--flow-minimap-node-fill)",
  wa_start: "var(--flow-minimap-node-fill)",
  wa_message: "var(--flow-minimap-node-fill)",
  wa_delay: "var(--flow-minimap-node-fill)",
  wa_media: "var(--flow-minimap-node-fill)",
  wa_booking: "var(--flow-minimap-node-fill)",
  wa_wait_reply: "var(--flow-minimap-node-fill)",
  wa_extract_var: "var(--flow-minimap-node-fill)",
  wa_tag: "var(--flow-minimap-node-fill)",
  wa_template: "var(--flow-minimap-node-fill)",
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
    width: 340,
    height: 260,
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
    <div className="nopan nodrag nowheel absolute bottom-3 right-3 z-20 hidden overflow-hidden rounded-md border border-[var(--flow-minimap-border)] bg-[var(--flow-minimap-bg)] shadow-[0_8px_24px_-10px_rgba(0,0,0,0.55)] backdrop-blur-md transition-opacity hover:opacity-100 opacity-80 md:block">
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

  const {
    nodes,
    edges,
    variables,
    onNodesChange,
    onEdgesChange,
    onConnect,
    onReconnect,
    flowVersion,
    selectNode,
    undo,
    redo,
    copySelection,
    pasteClipboard,
    duplicateSelection,
    deleteSelection,
    setStartNode,
    saveSelectionAsComponent,
    addNode,
  } = useBuilderStore();
  const [menu, setMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menu]);
  const renderEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        type: "smoothstep",
        reconnectable: true,
      })),
    [edges],
  );
  const edgeTypes = useMemo(() => ({ smoothstep: FlowDeletableEdge }), []);
  const issueMap = useMemo(
    () => issueMapFromList(validateFlow(nodes, edges, variables)),
    [nodes, edges, variables],
  );

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

  const onEdgeClick: EdgeMouseHandler = () => {
    /* removal is the mid-edge X — keep the click for selection only */
  };

  const memoTypes = useMemo(() => NodeRenderers, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableHotkeyTarget(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        undo();
        return;
      }
      if (meta && ((e.key === "z" && e.shiftKey) || e.key === "y")) {
        e.preventDefault();
        redo();
        return;
      }
      if (meta && e.key === "c") {
        e.preventDefault();
        copySelection();
        return;
      }
      if (meta && e.key === "v") {
        e.preventDefault();
        pasteClipboard();
        return;
      }
      if (meta && e.key === "d") {
        e.preventDefault();
        duplicateSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelection, duplicateSelection, pasteClipboard, redo, undo]);

  return (
    <NodeIssueContext.Provider value={issueMap}>
    <ReactFlow
      nodes={nodes}
      edges={renderEdges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onConnect={onConnect}
      onReconnect={(oldEdge: Edge, c: Connection) => onReconnect(oldEdge, c)}
      edgesReconnectable
      onEdgeClick={onEdgeClick}
      onNodeClick={(_, node) => {
        setMenu(null);
        selectNode(node.id);
      }}
      onPaneClick={() => {
        setMenu(null);
        selectNode(null);
      }}
      onNodeContextMenu={(e, node) => {
        e.preventDefault();
        selectNode(node.id);
        setMenu({ x: e.clientX, y: e.clientY, nodeId: node.id });
      }}
      onPaneContextMenu={(e) => {
        e.preventDefault();
        setMenu({ x: e.clientX, y: e.clientY });
      }}
      onMove={(_, nextViewport) => setViewport(nextViewport)}
      nodeTypes={memoTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.4, maxZoom: 0.7 }}
      minZoom={0.2}
      maxZoom={2}
      snapToGrid
      snapGrid={[18, 18]}
      multiSelectionKeyCode="Shift"
      selectionKeyCode="Shift"
      deleteKeyCode={["Backspace", "Delete"]}
      proOptions={{ hideAttribution: true }}
      defaultEdgeOptions={{
        type: "smoothstep",
        animated: false,
        style: {
          stroke: "var(--flow-edge)",
          strokeWidth: 1.35,
          filter: "drop-shadow(0 0 4px rgba(125, 211, 252, 0.28))",
        },
        labelStyle: { fill: "#cbd5e1", fontSize: 10, fontWeight: 500 },
        labelBgStyle: { fill: "#0b1220", fillOpacity: 0.92 },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
      }}
    >
      <Background id="flow-lines" variant="lines" gap={72} color="var(--flow-grid-major)" />
      <Background id="flow-dots" variant="dots" gap={18} size={1.4} color="var(--flow-grid)" />
      <Controls
        showInteractive={false}
        className="!bg-primary !text-primary-foreground !border-primary [&>button]:!bg-primary [&>button]:!text-primary-foreground [&>button]:!border-primary/40 [&>button:hover]:!bg-primary/80"
      />
      <FlowMiniMap nodes={nodes} viewport={viewport} canvasSize={canvasSize} />
      {nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-lg border border-white/[0.08] bg-background/80 px-4 py-3 text-center text-[12px] text-muted-foreground">
            Empty canvas. Right-click to add a node, or open Components.
          </div>
        </div>
      )}
    </ReactFlow>
    {menu && (
      <div
        className="fixed z-50 min-w-40 rounded-md border border-white/[0.08] bg-popover p-1 text-[12px] shadow-md"
        style={{ left: menu.x, top: menu.y }}
        onClick={() => setMenu(null)}
      >
        {menu.nodeId ? (
          <>
            <button className="block w-full rounded px-2 py-1 text-left hover:bg-white/[0.06]" onClick={() => selectNode(menu.nodeId!)}>
              Edit
            </button>
            <button className="block w-full rounded px-2 py-1 text-left hover:bg-white/[0.06]" onClick={() => duplicateSelection()}>
              Duplicate
            </button>
            <button
              className="block w-full rounded px-2 py-1 text-left hover:bg-white/[0.06]"
              onClick={() => setStartNode(menu.nodeId!)}
            >
              Set as start
            </button>
            <button
              className="block w-full rounded px-2 py-1 text-left hover:bg-white/[0.06]"
              onClick={() => {
                const result = saveSelectionAsComponent("Saved selection");
                if (result.ok) toast.success("Saved as component");
                else toast.error(result.error);
              }}
            >
              Save as component
            </button>
            <button className="block w-full rounded px-2 py-1 text-left text-rose-300 hover:bg-white/[0.06]" onClick={() => deleteSelection()}>
              Delete
            </button>
          </>
        ) : (
          <>
            <button
              className="block w-full rounded px-2 py-1 text-left hover:bg-white/[0.06]"
              onClick={() => addNode("conversation")}
            >
              Add conversation
            </button>
            <button className="block w-full rounded px-2 py-1 text-left hover:bg-white/[0.06]" onClick={() => pasteClipboard()}>
              Paste
            </button>
          </>
        )}
      </div>
    )}
    </NodeIssueContext.Provider>
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
    <div
      ref={setRefs}
      className="h-full w-full bg-[var(--flow-canvas)]"
      style={{ backgroundImage: "var(--flow-canvas-sheen)" }}
    >
      <ReactFlowProvider>
        <CanvasInner containerRef={internalRef} onReady={onReady} />
      </ReactFlowProvider>
    </div>
  );
}
