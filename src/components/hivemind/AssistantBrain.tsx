import { useEffect, useRef } from "react";

type BrainState = "idle" | "listening" | "thinking" | "speaking" | "error";
type Point = { x: number; y: number; z: number; gold: boolean };
const TAU = Math.PI * 2;
const points: Point[] = [];
const edges: [number, number][] = [];

// Two folded ellipsoidal surfaces, separated by a narrow longitudinal fissure.
const rings=24, segments=40;
for(const side of [-1,1]){
 const base=points.length;
 for(let i=0;i<=rings;i++){
  const latitude=Math.PI*(.045+.91*i/rings);
  for(let j=0;j<segments;j++){
   const u=j/segments*TAU;
   // Meandering surface coordinates and narrow grooves suggest cortical folds,
   // rather than the straight latitude/longitude grid of a generic sphere.
   const longitude=u+.085*Math.sin(latitude*8+u*3);
   const v=latitude+.048*Math.sin(u*5+latitude*4)*Math.sin(latitude);
   const sy=Math.cos(v),sr=Math.sin(v);
   const groove=Math.pow(.5+.5*Math.sin(u*7+v*9+.65*Math.sin(v*5-u*2)),6);
   const fold=1-.15*groove+.035*Math.sin(u*3-v*4);
   const x=side*(.018+(.5+.5*Math.cos(longitude))*sr*.76*fold);
   // Fuller upper lobes and a tucked-in underside give a cerebral silhouette.
   const y=Math.sign(sy)*Math.pow(Math.abs(sy),.82)*.58*(1-.07*groove);
   const z=Math.sin(longitude)*sr*.78*fold;
   const index=points.length;
   points.push({x,y,z,gold:(i*17+j*13+(side+1)*7)%83===0});
   if(i>0)edges.push([index-segments,index]);
   edges.push([index,base+i*segments+(j+1)%segments]);
   if(i>0&&(i+j)%7===0)edges.push([index-segments,base+i*segments+(j+1)%segments]);
  }
 }
}
// A small folded cerebellum underneath the rear of the larger hemispheres.
const cerebellum=points.length;
for(let i=0;i<=7;i++)for(let j=0;j<20;j++){
 const v=Math.PI*(.08+.84*i/7),u=j/20*TAU,index=points.length;
 const r=1+.045*Math.cos(v*24);
 points.push({x:Math.cos(u)*Math.sin(v)*.30*r,y:-.47+Math.cos(v)*.20,z:-.35+Math.sin(u)*Math.sin(v)*.26,gold:false});
 edges.push([index,cerebellum+i*20+(j+1)%20]);if(i)edges.push([index-20,index]);
}
// A short tapered neural stem, kept subordinate to the cerebral hemispheres.
const stem=points.length;
for(let i=0;i<5;i++)for(let j=0;j<8;j++){
 const a=j/8*TAU,r=.12-i*.014,index=points.length;
 points.push({x:Math.cos(a)*r,y:-.54-i*.043,z:-.13+Math.sin(a)*r,gold:false});
 edges.push([index,stem+i*8+(j+1)%8]);if(i)edges.push([index-8,index]);
}

/** Approved neural-brain mesh; decorative and independent of chat/audio state. */
export function AssistantBrain({ state, hovered = false }: { state: BrainState; hovered?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const props = useRef({ state, hovered });
  const redraw = useRef<() => void>(() => {});
  useEffect(() => { props.current = { state, hovered }; redraw.current(); }, [state, hovered]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let angle = -.42, last = performance.now(), frameId = 0;
    let width = 64, height = 64;
    let dark = document.documentElement.classList.contains("dark");

    function draw() {
      if (!ctx) return;
      const { state, hovered } = props.current;
      const active = hovered || state === "speaking" || state === "listening";
      const scale = Math.min(width * .48, height * .48), cy = height * .48;
      ctx.clearRect(0, 0, width, height);
      const projected = points.map(p => {
        const x = p.x * Math.cos(angle) + p.z * Math.sin(angle);
        const z = -p.x * Math.sin(angle) + p.z * Math.cos(angle);
        const y = p.y * .975 - z * .22, depth = p.y * .22 + z * .975;
        const perspective = 3.9 / (3.9 - depth);
        return { x: width / 2 + x * scale * perspective, y: cy - y * scale * perspective, z: depth, gold: p.gold };
      });
      ctx.lineWidth = .48;
      for (const [a, b] of edges) {
        const p = projected[a], q = projected[b], depth = (p.z + q.z) / 2;
        const alpha = (depth > 0 ? .2 + depth * .19 : .045) * (active ? 1.4 : 1);
        ctx.strokeStyle = dark ? `rgba(99,204,228,${alpha})` : `rgba(13,102,128,${alpha * 1.35})`;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      projected.sort((a, b) => a.z - b.z).forEach(p => {
        const front = p.z > -.08, alpha = front ? .6 + Math.max(0, p.z) * .4 : .15;
        const gold = state === "error" ? (dark ? "248,113,113" : "185,28,28") : (dark ? "245,194,0" : "145,101,0");
        ctx.fillStyle = `rgba(${p.gold ? gold : dark ? "151,232,247" : "9,103,127"},${alpha})`;
        const radius = .64 * (p.gold ? 1.65 : 1);
        ctx.shadowColor = state === "error" ? "#ef4444" : dark ? "#f5c200" : "#ac8100";
        ctx.shadowBlur = p.gold && front ? (active || state === "thinking" ? 4 : 0) : 0;
        ctx.beginPath(); ctx.arc(p.x, p.y, radius, 0, TAU); ctx.fill();
      });
      ctx.shadowBlur = 0;
    }
    function tick(now: number) {
      if (document.hidden || motion.matches || (!props.current.hovered && props.current.state === "idle")) { frameId = 0; return; }
      // Cap canvas rendering at 30fps; maintain a 38-second rotation.
      if (now - last >= 1000 / 30) {
        angle += Math.min((now - last) / 1000, .1) * TAU / 38;
        last = now; draw();
      }
      frameId = requestAnimationFrame(tick);
    }
    function restart() {
      cancelAnimationFrame(frameId); frameId = 0; last = performance.now(); draw();
      if (!document.hidden && !motion.matches && (props.current.hovered || props.current.state !== "idle")) frameId = requestAnimationFrame(tick);
    }
    function resize() {
      if (!canvas || !ctx) return;
      const rect = canvas.getBoundingClientRect();
      width = rect.width; height = rect.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw();
    }
    const resizeObserver = new ResizeObserver(resize);
    const themeObserver = new MutationObserver(() => {
      dark = document.documentElement.classList.contains("dark"); draw();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    resizeObserver.observe(canvas);
    motion.addEventListener("change", restart);
    document.addEventListener("visibilitychange", restart);
    redraw.current = restart;
    resize(); restart();
    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect(); themeObserver.disconnect();
      motion.removeEventListener("change", restart);
      document.removeEventListener("visibilitychange", restart);
      redraw.current = () => {};
    };
  }, []);
  return <canvas ref={canvasRef} className="pointer-events-none block h-16 w-16" aria-hidden="true" />;
}
