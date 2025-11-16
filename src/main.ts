import "./style.css";
import { initialiseEditor } from "./editor.js";
import {
  hasShareUrlParam,
  loadFromUrl,
  updateUrlPatchFromUi,
} from "./share-url.ts";
import { setError } from "./status.ts";
import {
  initialiseGitHubState,
  loadGitHubInfoFromStorage,
} from "./github-ui.ts";
import { updatePlotConfigFromCode } from "./plotter.ts";
import {
  getAudioParams,
  isAudioRunning,
  scheduleAudioUpdate,
  updateAudioWorkletParams,
  updateMasterGain,
} from "./audio-state.ts";
import {
  classicCheckbox,
  floatCheckbox,
  gainInput,
  gainValueSpan,
  playButton,
  sampleRateInput,
} from "./selectors.ts";
import { getCurrentProject, stopPlayback } from "./project.ts";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Root element #app not found");
}

const PROJECT_STORAGE_KEY = "bb-project";
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
    const storedProject = window.localStorage.getItem(PROJECT_STORAGE_KEY);
    if (storedProject) {
      try {
        const parsed = JSON.parse(storedProject) as {
          code?: unknown;
          sampleRate?: unknown;
          classic?: unknown;
          float?: unknown;
        };
        if (typeof parsed.code === "string" && parsed.code.trim().length > 0) {
          initialCode = parsed.code;
        }
        if (
          typeof parsed.sampleRate === "number" &&
          Number.isFinite(parsed.sampleRate)
        ) {
          initialSampleRate = parsed.sampleRate;
        }
        if (typeof parsed.classic === "boolean") {
          initialClassic = parsed.classic;
        }
        if (typeof parsed.float === "boolean") {
          initialFloat = parsed.float;
        }
      } catch (e) {
        console.error(e);
      }
    }
  } catch {
    // ignore storage errors (e.g. disabled cookies)
  }
}

loadGitHubInfoFromStorage();

initialiseEditor(initialCode, () => {
  updateUrlPatchFromUi();
  scheduleAudioUpdate();
  storeProjectInLocalStorage();
});

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

initialiseGitHubState();

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
  await stopPlayback();
}

function storeProjectInLocalStorage() {
  try {
    const project = getCurrentProject();
    window.localStorage.setItem(PROJECT_STORAGE_KEY, JSON.stringify(project));
  } catch {
    // ignore storage errors
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
    storeProjectInLocalStorage();
  });
}

if (classicCheckbox) {
  classicCheckbox.addEventListener("change", () => {
    updateUrlPatchFromUi();
    scheduleAudioUpdate();
    storeProjectInLocalStorage();
  });
}

if (floatCheckbox) {
  floatCheckbox.addEventListener("change", () => {
    updateUrlPatchFromUi();
    scheduleAudioUpdate();
    storeProjectInLocalStorage();
  });
}

if (gainInput) {
  gainInput.addEventListener("input", () => {
    const raw = gainInput?.value;
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
