import "./style.css";
import { getEditorValue, initialiseEditor } from "./editor.js";
import {
  hasShareUrlParam,
  loadFromUrl,
  updateUrlPatchFromUi,
} from "./share-url.ts";
import { setError } from "./status.ts";
import { loadGitHubInfoFromStorage, setupGitHubUi } from "./github-ui.ts";
import { stopRealtimePlot, updatePlotConfigFromCode } from "./plotter.ts";
import {
  getAudioParams,
  isAudioRunning,
  scheduleAudioUpdate,
  suspendAudioContext,
  updateAudioWorkletParams,
  updateMasterGain,
} from "./audio-state.ts";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Root element #app not found");
}

const EDITOR_STORAGE_KEY = "bb-editor-code";

let initialCode = `a=plot(t>>10&7),
a*t`;
let initialSampleRate: number | null = null;
let initialClassic: boolean | null = null;
let initialFloat: boolean | null = null;

const initialParams = loadFromUrl();

if (initialParams?.initialCode) initialCode = initialParams.initialCode;
if (initialParams?.initialSampleRate)
  initialSampleRate = initialParams.initialSampleRate;
if (initialParams?.initialClassic)
  initialClassic = initialParams.initialClassic;
if (initialParams?.initialFloat) initialFloat = initialParams.initialFloat;

if (!hasShareUrlParam()) {
  try {
    const stored = window.localStorage.getItem(EDITOR_STORAGE_KEY);
    if (stored) {
      initialCode = stored;
    }
  } catch {
    // ignore storage errors (e.g. disabled cookies)
  }
}

initialiseEditor(initialCode, () => {
  try {
    const code = getEditorValue();
    window.localStorage.setItem(EDITOR_STORAGE_KEY, code);
  } catch {
    // ignore storage errors
  }
  updateUrlPatchFromUi();
  scheduleAudioUpdate();
});

const playButton = document.querySelector<HTMLButtonElement>("#bb-play-button");
const sampleRateInput =
  document.querySelector<HTMLInputElement>("#bb-sample-rate");
const classicCheckbox = document.querySelector<HTMLInputElement>("#bb-classic");
const floatCheckbox = document.querySelector<HTMLInputElement>("#bb-float");
const gainInput = document.querySelector<HTMLInputElement>("#bb-gain");
const gainValueSpan = document.querySelector<HTMLSpanElement>("#bb-gain-value");

loadGitHubInfoFromStorage();

if (sampleRateInput && initialSampleRate !== null) {
  const sr = Math.min(
    48000,
    Math.max(
      500,
      Math.floor(Number.isFinite(initialSampleRate) ? initialSampleRate : 8000),
    ),
  );
  sampleRateInput.value = String(sr);
}

if (classicCheckbox && initialClassic !== null) {
  classicCheckbox.checked = initialClassic;
}

if (floatCheckbox && initialFloat !== null) {
  floatCheckbox.checked = initialFloat;
}

setupGitHubUi();

async function handlePlayClick() {
  setError(null);

  const params = getAudioParams();
  if (!params) return;

  const { expression, targetSampleRate, classic, float } = params;

  try {
    await updateAudioWorkletParams(
      expression,
      targetSampleRate,
      classic,
      float,
    );

    updatePlotConfigFromCode(targetSampleRate);

    if (playButton) {
      playButton.textContent = "Stop";
      playButton.classList.add("bb-play-button--active");
    }
  } catch (error) {
    setError("Failed to start audio playback.");
    console.error("Failed to start audio playback", error);
  }
}

async function handleStopClick() {
  await suspendAudioContext();

  stopRealtimePlot();

  if (playButton) {
    playButton.textContent = "Play";
    playButton.classList.remove("bb-play-button--active");
  }
}

if (playButton) {
  playButton.addEventListener("click", () => {
    if (isAudioRunning()) {
      void handleStopClick();
    } else {
      void handlePlayClick();
    }
  });
}

if (sampleRateInput) {
  sampleRateInput.addEventListener("change", () => {
    updateUrlPatchFromUi();
    scheduleAudioUpdate();
  });
}

if (classicCheckbox) {
  classicCheckbox.addEventListener("change", () => {
    updateUrlPatchFromUi();
    scheduleAudioUpdate();
  });
}

if (gainInput) {
  gainInput.addEventListener("input", () => {
    const raw = gainInput.value;
    const parsed = raw ? Number(raw) : Number.NaN;

    if (gainValueSpan) {
      let gainPercent = Math.floor(parsed * 100);
      gainValueSpan.textContent = `${gainPercent}%`;
    }

    updateMasterGain(parsed * parsed);
  });
}

window.addEventListener("keydown", (event: KeyboardEvent) => {
  if (!event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) return;
  if (!(event.code === "Space" || event.key === " ")) return;

  event.preventDefault();

  if (isAudioRunning()) {
    void handleStopClick();
  } else {
    void handlePlayClick();
  }
});
