/**
 * What a browser test call needs from the deploy dialog: its refs (audio graph, sockets,
 * recorder), state setters, a snapshot of the builder state, and the dialog's call helpers.
 *
 * The dialog builds one when a call starts (`testCallSession()`), so each test-call routine sees
 * the same values it did when it was written inline in the dialog.
 */
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { RetellWebClient } from "retell-client-js-sdk";
import type { BuilderStoreState } from "@/lib/builder/store";
import type { AudioPlaybackController } from "@/lib/voice/browser/audio-playback-controller.shared";
import type { createRetellWebCall, getElevenLabsSignedUrl } from "@/lib/builder/retell.functions";
import type { TestCallPrepResult } from "../TestCallPrepDialog";
import type { TxEntry } from "../RetellDeployDialog";

type Ref<T> = MutableRefObject<T>;
type Setter<T> = Dispatch<SetStateAction<T>>;
/** A server function as `useServerFn` hands it to the client: just the call. */
type ClientServerFn<F extends (...args: any[]) => any> = (...args: Parameters<F>) => ReturnType<F>;

export type TestCallSession = {
  // Audio graph and capture
  audioCtxRef: Ref<AudioContext | null>;
  activeSourceNodesRef: Ref<AudioBufferSourceNode[]>;
  captureSinkRef: Ref<GainNode | null>;
  keepAliveRef: Ref<OscillatorNode | null>;
  masterGainRef: Ref<GainNode | null>;
  nextPlayTimeRef: Ref<number>;
  processorRef: Ref<ScriptProcessorNode | null>;
  workletRef: Ref<AudioWorkletNode | null>;
  streamRef: Ref<MediaStream | null>;
  elPlaybackRef: Ref<AudioPlaybackController | null>;
  // Recording
  recChunksRef: Ref<Blob[]>;
  recorderRef: Ref<MediaRecorder | null>;
  recordedCallRef: Ref<boolean>;
  // Connection
  clientRef: Ref<RetellWebClient | null>;
  wsRelayRef: Ref<WebSocket | null>;
  wsConnectTimeoutRef: Ref<ReturnType<typeof setTimeout> | null>;
  wsPingRef: Ref<ReturnType<typeof setInterval> | null>;
  // Call bookkeeping
  startedAtRef: Ref<number | null>;
  callEndFiredRef: Ref<boolean>;
  callCostUsdRef: Ref<number | undefined>;
  channelTypeRef: Ref<string | undefined>;
  endReasonRef: Ref<string | undefined>;
  hsSessionIdRef: Ref<string | undefined>;
  testCallPrepRef: Ref<TestCallPrepResult>;
  onLatencyUpdateRef: Ref<((ms: number) => void) | undefined>;
  // State
  setCalling: Setter<boolean>;
  setInCall: Setter<boolean>;
  setElapsedSec: Setter<number>;
  setHsExactCostUsd: Setter<number | null>;
  transcript: TxEntry[];
  cost: number;
  hsExactCostUsd: number | null;
  isWebeeNative: boolean;
  // Builder
  nodes: BuilderStoreState["nodes"];
  edges: BuilderStoreState["edges"];
  settings: BuilderStoreState["settings"];
  variables: BuilderStoreState["variables"];
  currentAgentRowId: BuilderStoreState["currentAgentRowId"];
  setActiveNode: BuilderStoreState["setActiveNode"];
  clearDebugEvents: BuilderStoreState["clearDebugEvents"];
  // Helpers
  emitDebug: (type: string, message: string, extra?: { nodeId?: string; detail?: Record<string, unknown> }) => void;
  pushTranscript: (updater: TxEntry[] | ((prev: TxEntry[]) => TxEntry[])) => void;
  finalizeRecording: () => void;
  recordCurrentCallCost: () => void;
  endCall: () => void;
  startCall: ClientServerFn<typeof createRetellWebCall>;
  getElSignedUrl: ClientServerFn<typeof getElevenLabsSignedUrl>;
};
