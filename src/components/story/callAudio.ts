/**
 * Voice for the simulated demo call.
 *
 * Two sources, chosen per line:
 *   1. A real recording at /audio/demo/turn-N.mp3 if one exists (generated
 *      offline by scripts/gen-demo-voice.mjs).
 *   2. Otherwise the browser's built-in speech (Web Speech API): free, offline,
 *      no files, but quality varies by browser and OS.
 *
 * On top of the recordings, a small Web Audio graph makes it feel like a real
 * phone call:
 *   - ring(): a UK double ring and a pick-up click before the first line,
 *     synthesised (no files).
 *   - The CALLER goes through a telephone band-pass (about 300-3400 Hz, the
 *     band a phone line carries) with a little presence and compression; Ava
 *     stays full-range, like the receptionist end of the line.
 *   - level(): live loudness of whatever is playing, for the speaking bars.
 *   - speak(..., onProgress): how far through the line playback is (0..1), so
 *     the transcript can reveal word by word in time with the voice.
 * The browser-speech fallback can't be routed through Web Audio, so there
 * level() returns -1 (callers fall back to the CSS bar loop) and progress is
 * estimated from word boundaries.
 *
 * ISOLATION: this never calls the product's TTS providers at runtime. The
 * marketing demo must not spend money or touch production services; files
 * are generated offline and shipped as static assets.
 *
 * Every speak() and ring() resolves — on end, on error, on cancel, or on a
 * safety timeout — so the call never stalls waiting for audio.
 */

export type Speaker = "agent" | "caller";

const AGENT_PREF =
  /(sonia|libby|hazel|susan|serena|female|zira|aria|jenny|samantha|google uk english female)/i;
const CALLER_PREF = /(ryan|george|thomas|daniel|male|guy|david|google uk english male)/i;

type Ctx = AudioContext;

export function createCallVoice() {
  const synth: SpeechSynthesis | null =
    typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;

  const fileCheck = new Map<string, Promise<boolean>>();
  let audio: HTMLAudioElement | null = null;
  let settle: (() => void) | null = null;
  let raf = 0;

  // ── Web Audio (created lazily, from a click, so browsers allow it) ──────
  let ctx: Ctx | null = null;
  let analyser: AnalyserNode | null = null;
  let meter: Uint8Array<ArrayBuffer> | null = null;
  let metering = false; // true only while a routed recording is playing
  const ringNodes: AudioScheduledSourceNode[] = [];

  function ensureCtx(): Ctx | null {
    if (ctx) return ctx;
    const AC =
      typeof window !== "undefined"
        ? window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        : undefined;
    if (!AC) return null;
    try {
      ctx = new AC();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.6;
      analyser.connect(ctx.destination);
      meter = new Uint8Array(analyser.fftSize);
    } catch {
      ctx = null;
    }
    return ctx;
  }

  /** The telephone end of the line: band-limited, a touch of presence,
   *  gently compressed. Returns the chain's input node. */
  function phoneChain(c: Ctx, out: AudioNode) {
    const hp = c.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 320;
    hp.Q.value = 0.7;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3300;
    lp.Q.value = 0.7;
    const presence = c.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 1800;
    presence.Q.value = 1;
    presence.gain.value = 4;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -24;
    comp.ratio.value = 4;
    const gain = c.createGain();
    gain.gain.value = 1.15; // band-limiting loses some loudness; make it back
    hp.connect(lp).connect(presence).connect(comp).connect(gain).connect(out);
    return hp;
  }

  function voices() {
    return (synth?.getVoices() ?? []).filter((v) => v.lang.toLowerCase().startsWith("en"));
  }

  /** Prefer a British voice; agent and caller should never share one. */
  function pick(role: Speaker): SpeechSynthesisVoice | null {
    const all = voices();
    if (!all.length) return null;
    const gb = all.filter((v) => v.lang.toLowerCase() === "en-gb");
    const pool = gb.length >= 2 ? gb : all;
    const pref = role === "agent" ? AGENT_PREF : CALLER_PREF;
    const hit = pool.find((v) => pref.test(v.name)) ?? all.find((v) => pref.test(v.name));
    if (hit) return hit;
    // No name match: take different voices by position.
    return role === "agent" ? pool[0] : (pool[1] ?? pool[0]);
  }

  /** HEAD-probe once per file. Rejects HTML: an SPA fallback answers unknown
   *  paths with index.html and a 200. Anything else counts as the file — some
   *  servers label .mp3 as application/octet-stream rather than audio/mpeg. */
  function hasFile(url: string) {
    let p = fileCheck.get(url);
    if (!p) {
      p = fetch(url, { method: "HEAD" })
        .then((r) => r.ok && !(r.headers.get("content-type") ?? "").includes("text/html"))
        .catch(() => false);
      fileCheck.set(url, p);
    }
    return p;
  }

  function stopProgress() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function playFile(url: string, role: Speaker, onProgress?: (f: number) => void) {
    return new Promise<void>((resolve) => {
      const a = new Audio(url);
      audio = a;
      let src: MediaElementAudioSourceNode | null = null;
      const finish = () => {
        stopProgress();
        metering = false;
        try {
          src?.disconnect();
        } catch {
          /* already gone */
        }
        onProgress?.(1);
        resolve();
      };
      settle = finish;

      // Route through Web Audio only when the context is actually running:
      // an element attached to a suspended context plays silence.
      const c = ctx;
      if (c && c.state === "running" && analyser) {
        try {
          src = c.createMediaElementSource(a);
          if (role === "caller") src.connect(phoneChain(c, analyser));
          else src.connect(analyser);
          metering = true;
        } catch {
          src = null;
        }
      }

      if (onProgress) {
        const tick = () => {
          if (a.duration > 0 && Number.isFinite(a.duration)) onProgress(a.currentTime / a.duration);
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      }
      a.onended = finish;
      a.onerror = finish;
      a.play().catch(finish);
    });
  }

  function speakSynth(role: Speaker, text: string, onProgress?: (f: number) => void) {
    return new Promise<void>((resolve) => {
      if (!synth) return resolve();
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(guard);
        clearInterval(est);
        onProgress?.(1);
        resolve();
      };
      settle = finish;
      const u = new SpeechSynthesisUtterance(text);
      const v = pick(role);
      if (v) u.voice = v;
      u.lang = v?.lang ?? "en-GB";
      // Small rate and pitch differences keep two speakers distinguishable
      // even when the browser only offers one decent voice.
      u.rate = role === "agent" ? 1.03 : 0.98;
      u.pitch = role === "agent" ? 1.05 : 0.9;
      // Progress: real word boundaries where the browser reports them, a
      // time estimate otherwise (whichever is further along wins).
      let fromBoundary = 0;
      const started = performance.now();
      const total = estimateMs(text);
      u.onboundary = (e) => {
        fromBoundary = Math.max(fromBoundary, (e.charIndex + (e.charLength || 1)) / text.length);
      };
      const est = setInterval(() => {
        const t = Math.min(0.97, (performance.now() - started) / total);
        onProgress?.(Math.max(t, fromBoundary));
      }, 60);
      u.onend = finish;
      u.onerror = finish;
      const guard = setTimeout(finish, text.length * 95 + 2500);
      synth.speak(u);
    });
  }

  return {
    /** True when at least the speech fallback is available. */
    supported: !!synth,

    /** Call from a click handler: creates/resumes the audio context while the
     *  browser still counts it as user-initiated. */
    unlock() {
      const c = ensureCtx();
      if (c && c.state === "suspended") void c.resume().catch(() => {});
    },

    /** Ring twice, then a pick-up click. ~2.4s. Resolves early on cancel. */
    ring() {
      return new Promise<void>((resolve) => {
        const c = ctx;
        if (!c || c.state !== "running") return resolve();
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve();
        };
        settle = finish;

        const out = c.createGain();
        out.gain.value = 0.05; // the ring sits well under the voices
        out.connect(c.destination);
        const t0 = c.currentTime + 0.05;
        // UK ring cadence: 0.4s on, 0.2s off, 0.4s on, then a pause.
        const bursts = [0, 0.6];
        for (const at of bursts) {
          for (const f of [400, 450]) {
            const o = c.createOscillator();
            o.frequency.value = f;
            const g = c.createGain();
            g.gain.setValueAtTime(0, t0 + at);
            g.gain.linearRampToValueAtTime(1, t0 + at + 0.02);
            g.gain.setValueAtTime(1, t0 + at + 0.38);
            g.gain.linearRampToValueAtTime(0, t0 + at + 0.4);
            o.connect(g).connect(out);
            o.start(t0 + at);
            o.stop(t0 + at + 0.42);
            ringNodes.push(o);
          }
        }
        // Pick-up: a short filtered noise click after a natural pause.
        const clickAt = t0 + 1.9;
        const len = Math.floor(c.sampleRate * 0.035);
        const buf = c.createBuffer(1, len, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
        const noise = c.createBufferSource();
        noise.buffer = buf;
        const bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1500;
        const cg = c.createGain();
        cg.gain.value = 4; // relative to `out`
        noise.connect(bp).connect(cg).connect(out);
        noise.start(clickAt);
        ringNodes.push(noise);

        const timer = setTimeout(finish, 2400);
      });
    },

    async speak(role: Speaker, text: string, key: string, onProgress?: (f: number) => void) {
      const url = `/audio/demo/${key}.mp3`;
      if (await hasFile(url)) return playFile(url, role, onProgress);
      return speakSynth(role, text, onProgress);
    },

    /** Loudness of the recording playing now, 0..1, or -1 when it can't be
     *  measured (browser speech, or Web Audio unavailable). */
    level() {
      if (!metering || !analyser || !meter) return -1;
      analyser.getByteTimeDomainData(meter);
      let sum = 0;
      for (let i = 0; i < meter.length; i++) {
        const v = (meter[i] - 128) / 128;
        sum += v * v;
      }
      return Math.min(1, Math.sqrt(sum / meter.length) * 4);
    },

    /** Stop whatever is playing and release the pending speak()/ring(). */
    cancel() {
      synth?.cancel();
      stopProgress();
      metering = false;
      for (const n of ringNodes.splice(0)) {
        try {
          n.stop();
        } catch {
          /* not started or already stopped */
        }
      }
      if (audio) {
        audio.pause();
        audio = null;
      }
      const s = settle;
      settle = null;
      s?.();
    },
  };
}

/** Rough speaking time for a line, used when sound is off so the silent
 *  call keeps a believable pace. */
export function estimateMs(text: string) {
  return Math.min(4200, 700 + text.length * 48);
}
