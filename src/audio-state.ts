import { setError, setInfo } from "./status.ts";
import { updatePlotConfigFromCode } from "./plotter.ts";
import { getEditorValue } from "./editor.ts";
import { extractExpressionFromCode } from "./expression-utils.ts";
import {
  classicCheckbox,
  floatCheckbox,
  sampleRateInput,
} from "./selectors.ts";

let audioContext: AudioContext | null = null;
let bytebeatNode: AudioWorkletNode | null = null;
let gainNode: GainNode | null = null;
let hotReloadTimer: number | null = null;

type AudioParams = {
  expression: string;
  targetSampleRate: number;
  classic: boolean;
  float: boolean;
};

export function getAudioParams(): AudioParams | null {
  const code = getEditorValue();
  const expression = extractExpressionFromCode(code);

  if (!expression) {
    setError("Expression is empty.");
    return null;
  }

  try {
    void new Function("t", `return Number(${expression}) || 0;`);
  } catch (error) {
    setError("Expression does not compile.");
    console.error(error);
    return null;
  }

  setInfo("Compiled");

  const rawSr = sampleRateInput?.value;
  const parsedSr = rawSr ? Number(rawSr) : Number.NaN;
  let targetSampleRate = Number.isFinite(parsedSr) ? parsedSr : 8000;
  targetSampleRate = Math.min(
    48000,
    Math.max(500, Math.floor(targetSampleRate)),
  );

  const classic = !!classicCheckbox?.checked;
  const float = !!floatCheckbox?.checked;

  return { expression, targetSampleRate, classic, float };
}

export function getAudioCurrentTime(): number {
  if (audioContext) {
    return audioContext.currentTime;
  }
  return performance.now() / 1000;
}

export async function updateAudioParams() {
  if (!audioContext || !bytebeatNode) return;

  const params = getAudioParams();
  if (!params) return;

  const { expression, targetSampleRate, classic, float } = params;
  bytebeatNode.port.postMessage({
    type: "setExpression",
    expression,
    sampleRate: targetSampleRate,
    classic,
    float,
  });

  setInfo("Compiled");

  updatePlotConfigFromCode(targetSampleRate);
}

export function scheduleAudioUpdate() {
  if (!audioContext || audioContext.state !== "running" || !bytebeatNode) {
    return;
  }

  if (hotReloadTimer !== null) {
    window.clearTimeout(hotReloadTimer);
  }

  hotReloadTimer = window.setTimeout(() => {
    hotReloadTimer = null;
    void updateAudioParams();
  }, 150);
}

async function sleep(durationMs: number) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

export async function ensureAudioGraph(
  expression: string,
  targetSampleRate: number,
  classic: boolean,
  float: boolean,
) {
  if (!audioContext) {
    audioContext = new AudioContext();
    await audioContext.audioWorklet.addModule(
      new URL("./bytebeat-worklet.js", import.meta.url),
    );
    bytebeatNode = new AudioWorkletNode(audioContext, "bytebeat-processor");
    gainNode = audioContext.createGain();

    bytebeatNode.connect(gainNode);
    gainNode.gain.value = 0.25;
    gainNode.connect(audioContext.destination);

    bytebeatNode.port.onmessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; message?: string } | null;
      if (!data || !data.type) return;
      if (data.type === "compileError" || data.type === "runtimeError") {
        setError(data.message || "Error in expression.");
      }
    };

    // Wait a bit to warm-up audio graph
    await sleep(1000);
  }

  if (!bytebeatNode) return;

  bytebeatNode.port.postMessage({
    type: "setExpression",
    expression,
    sampleRate: targetSampleRate,
    classic,
    float,
  });
}

export async function updateAudioWorkletParams(
  expression: string,
  targetSampleRate: number,
  classic: boolean,
  float: boolean,
) {
  await ensureAudioGraph(expression, targetSampleRate, classic, float);
  if (!audioContext) return;

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  if (bytebeatNode) {
    bytebeatNode.port.postMessage({ type: "reset" });
  }
}

export async function suspendAudioContext() {
  if (!audioContext) return;
  try {
    await audioContext.suspend();
  } catch (error) {
    // ignore
  }
}

export function isAudioRunning(): boolean {
  return !!audioContext && audioContext.state === "running";
}

export function updateMasterGain(value: number): void {
  if (gainNode) {
    gainNode.gain.value = value;
  }
}
