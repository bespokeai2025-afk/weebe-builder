/**
 * GLSL for the hero surface.
 *
 * Why hand-written shaders rather than MeshStandardMaterial: stock PBR
 * materials give you correct lighting, not interesting lighting. Everything
 * that reads as "expensive" on a dark page comes from effects PBR does not
 * expose — a sharp Fresnel rim, thin-film iridescence that shifts with view
 * angle, and colour driven by the surface's own displacement. That is the
 * ceiling the procedural scenes kept hitting.
 *
 * Shaders live as template strings rather than .glsl files so the build needs
 * no extra Vite plugin. The project's Vite config is wrapped by
 * @lovable.dev/vite-tanstack-config, and adding plugins to it is explicitly
 * warned against in vite.config.ts.
 */

/** Ashima / Stefan Gustavson simplex noise — the standard public-domain 3D
 *  implementation. Shared by both stages. */
const SIMPLEX = /* glsl */ `
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}

float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
             i.z + vec4(0.0, i1.z, i2.z, 1.0))
           + i.y + vec4(0.0, i1.y, i2.y, 1.0))
           + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
`;

/**
 * Shared displacement, so vertex and normal always agree.
 *
 * TWO THINGS MAKE THIS READ AS FLOW RATHER THAN RIPPLE:
 *
 * 1. Advection. Time is subtracted from the sample POSITION, not passed as a
 *    third noise axis. Putting time on the third axis morphs the field in
 *    place — features bulge and subside where they stand. Shifting the
 *    sample point makes the whole field travel, which is what the eye reads
 *    as movement.
 *
 * 2. Anisotropy. Each octave is sampled at a much lower frequency along the
 *    flow axis than across it, so features stretch into streaks rather than
 *    staying as round blobs. Elongation along the direction of travel is the
 *    single strongest cue that something is flowing.
 *
 * A slow cross-drift and a small per-octave speed difference stop the layers
 * moving as one rigid sheet, which would read as a texture being panned.
 */
const FIELD = /* glsl */ `
uniform float uTime;
uniform float uAmp;
uniform float uScroll;
uniform float uSpeed;

/**
 * Talk / pause gate. Pure function of uTime, not of position, so the
 * fragment shader can compute the identical value from uTime alone rather
 * than carrying it across as a varying.
 *
 * Returns 1 while "speaking", falling to a FLOOR (never 0) while "paused" --
 * a surface that goes completely still reads as broken, not as a pause. The
 * floor is also what the "I can't see any motion" bug taught: always leave
 * something moving.
 */
float speechGate(float time){
  float cycleLen = 5.0;
  float talkLen  = 3.6;
  float cyclePos = mod(time, cycleLen);
  float gate = smoothstep(0.0, 0.25, cyclePos)
             * (1.0 - smoothstep(talkLen, talkLen + 0.4, cyclePos));
  return 0.25 + 0.75 * gate;
}

/**
 * One pulse in a repeating train along the flow axis: a sharp attack and a
 * slower exponential decay. A train of these is what separates "speaking"
 * from "flowing liquid" -- speech has onsets and silences, not a constant
 * hum, however the ambient fluid motion underneath still looks.
 */
float syllable(float along, float spacing, float decay){
  float cyc = fract(along / spacing);
  return smoothstep(0.0, 0.06, cyc) * exp(-cyc * decay);
}

float field(vec2 p){
  // Flow travels left-to-right with a slight downward drift.
  vec2 dir = normalize(vec2(1.0, -0.22));
  float t = uTime * uSpeed;

  // Each octave advects at its own rate. Faster small detail over slower
  // large forms gives parallax within the surface itself.
  vec2 q1 = p - dir * t * 0.55;
  vec2 q2 = p - dir * t * 0.92;
  vec2 q3 = p - dir * t * 1.45;

  // x frequency well below y frequency = features stretched along the flow.
  float a = snoise(vec3(q1.x * 0.17, q1.y * 0.46, 11.3)) * 1.00;
  float b = snoise(vec3(q2.x * 0.41, q2.y * 1.05, 37.9)) * 0.42;
  float c = snoise(vec3(q3.x * 0.95, q3.y * 2.10, 71.2)) * 0.15;

  float gate = speechGate(uTime);

  // Two trains of syllable packets at different spacing and decay, so they
  // never fall into lockstep and read as one mechanical pulse.
  float along = dot(p, dir) * 0.6 - t * 1.35;
  float along2 = dot(p, dir) * 0.6 - t * 1.1 + 7.0;
  float syllables = syllable(along, 2.1, 4.2) * 0.6
                   + syllable(along2, 1.4, 5.5) * 0.4;

  // Taper toward the edges so the sheet reads as an object with an outline
  // rather than a plane that runs off frame.
  float edge = (1.0 - smoothstep(3.0, 8.6, abs(p.x)))
              * (1.0 - smoothstep(1.9, 5.0, abs(p.y)));

  // The ambient flow stays alive even through a pause (lightly gated); the
  // syllable packets are what carry the talk/pause rhythm on top of it.
  float base = (a + b + c) * (0.55 + 0.45 * gate);

  return (base + syllables * gate * 0.9) * uAmp * edge;
}
`;

export const flowVertex = /* glsl */ `
${SIMPLEX}
${FIELD}

varying vec3 vWorld;
varying vec3 vNrm;
varying float vElev;
varying vec2 vUvW;

void main(){
  vec3 pos = position;
  float e = field(pos.xy);
  pos.z += e;

  // Normals by finite difference. Cheaper and more stable here than
  // recomputing them on the CPU every frame.
  float d = 0.12;
  float ex = field(pos.xy + vec2(d, 0.0));
  float ey = field(pos.xy + vec2(0.0, d));
  vec3 tx = normalize(vec3(d, 0.0, ex - e));
  vec3 ty = normalize(vec3(0.0, d, ey - e));
  vec3 n  = normalize(cross(tx, ty));

  vec4 world = modelMatrix * vec4(pos, 1.0);

  // Built explicitly rather than as mat3(modelMatrix): the matrix-from-matrix
  // constructor is GLSL ES 3.00, and three.js compiles ShaderMaterial as ESSL
  // 1.00 by default, where it fails to compile on stricter drivers.
  mat3 normalMat = mat3(
    modelMatrix[0].xyz,
    modelMatrix[1].xyz,
    modelMatrix[2].xyz
  );

  vWorld = world.xyz;
  vNrm   = normalize(normalMat * n);
  vElev  = e;
  vUvW   = pos.xy;

  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

export const flowFragment = /* glsl */ `
precision highp float;

uniform vec3  uGold;
uniform vec3  uCool;
uniform vec3  uDeep;
uniform float uTime;
uniform float uScroll;
uniform float uOpacity;
uniform float uSpeed;

varying vec3  vWorld;
varying vec3  vNrm;
varying float vElev;
varying vec2  vUvW;

/* Thin-film style iridescence: a cheap cosine palette offset by view angle.
   Gives the surface a hue shift as it turns, which is most of what separates
   a shader-lit object from a stock-material one. */
vec3 irid(float t){
  return 0.5 + 0.5 * cos(6.28318 * (vec3(0.96, 0.62, 0.38) * t + vec3(0.0, 0.22, 0.52)));
}

/* Mirrors the vertex shader's speechGate() exactly (pure function of uTime,
   not of position) so the streak lines pulse on the same talk/pause rhythm
   as the displacement, with no varying needed to carry it across. */
float speechGate(float time){
  float cycleLen = 5.0;
  float talkLen  = 3.6;
  float cyclePos = mod(time, cycleLen);
  float gate = smoothstep(0.0, 0.25, cyclePos)
             * (1.0 - smoothstep(talkLen, talkLen + 0.4, cyclePos));
  return 0.25 + 0.75 * gate;
}

void main(){
  vec3 N = normalize(vNrm);
  vec3 V = normalize(cameraPosition - vWorld);

  // Fresnel: bright where the surface turns away from the eye. This single
  // term is the difference between "lit" and "expensive".
  float ndv  = max(dot(N, V), 0.0);
  float fres = pow(1.0 - ndv, 2.6);

  // Base colour follows height: troughs sink to near-black, crests pick up
  // the cool accent.
  float h = smoothstep(-0.9, 1.1, vElev);
  vec3 base = mix(uDeep, uCool, h);

  // Gold lives on the rim only — it marks the form's edge rather than
  // tinting the whole surface, which is what keeps the page from going
  // yellow.
  vec3 rim = uGold * fres * 1.55;

  // Iridescent sheen, strongest at grazing angles, drifting slowly.
  vec3 sheen = irid(fres * 1.6 + vElev * 0.22 + uTime * 0.02) * fres * 0.42;

  // A specular glint from a fixed key direction, so the surface has one
  // bright moving highlight to track.
  vec3 L = normalize(vec3(-0.45, 0.72, 0.52));
  float spec = pow(max(dot(reflect(-L, N), V), 0.0), 42.0);

  /* Travelling filaments.
     Flow is only legible if something visibly MOVES ALONG it. These are thin
     bright lines advected on the same vector as the displacement, so they
     track the surface rather than sliding over it like a decal.

     The band function is sharpened with pow() so the lines stay thin and
     filament-like instead of reading as soft stripes, and they are gated by
     slope — they appear on the faces turned toward the light, which is where
     a real flowing surface catches it. */
  vec2 fdir = normalize(vec2(1.0, -0.22));
  float along = dot(vUvW, fdir) - uTime * uSpeed * 1.25;
  float across = dot(vUvW, vec2(-fdir.y, fdir.x));

  // Two sets at different frequencies, the slower one offset, so the streaks
  // never resolve into an obvious repeating comb.
  float s1 = sin(along * 2.35 + across * 0.22);
  float s2 = sin(along * 1.12 - across * 0.34 + 1.9);
  float band = pow(max(s1 * 0.6 + s2 * 0.4, 0.0), 7.0);

  // Only on slopes facing the key light, and never on the flat troughs.
  float slope = smoothstep(0.0, 0.55, dot(N, L));
  // Gated so the filaments visibly pulse with the talk/pause rhythm rather
  // than running at a constant rate underneath it.
  float streak = band * slope * smoothstep(-0.35, 0.75, vElev) * speechGate(uTime);

  vec3 col = base + rim + sheen
           + vec3(0.95, 0.97, 1.0) * spec * 0.55
           + mix(uCool, uGold, 0.35) * streak * 0.85;

  // Fade the far edges rather than cutting them, so the sheet dissolves into
  // the page background.
  float edgeFade = (1.0 - smoothstep(4.6, 8.4, abs(vUvW.x)))
                 * (1.0 - smoothstep(2.6, 5.0, abs(vUvW.y)));

  // Streaks lift opacity as well as colour, so they read as light passing
  // through the sheet rather than paint sitting on it.
  float alpha = clamp((0.24 + fres * 0.98 + h * 0.3 + streak * 0.45) * edgeFade, 0.0, 1.0) * uOpacity;

  gl_FragColor = vec4(col, alpha);
}
`;
