import {getEditorValue} from './editor.ts';
import {decodePatchFromBase64, encodePatchToBase64} from './path-encoding.ts';

const PATCH_PARAM_KEY = "p";

const sampleRateInput =
    document.querySelector<HTMLInputElement>("#bb-sample-rate");
const classicCheckbox = document.querySelector<HTMLInputElement>("#bb-classic");
const floatCheckbox = document.querySelector<HTMLInputElement>("#bb-float");

export function hasShareUrlParam(): boolean {
  return new URLSearchParams(window.location.search).has(PATCH_PARAM_KEY);
}

export function updateUrlPatchFromUi() {
  try {
    const code = getEditorValue();
    const rawSr = sampleRateInput?.value;
    const parsedSr = rawSr ? Number(rawSr) : Number.NaN;
    let sr = Number.isFinite(parsedSr) ? parsedSr : 8000;
    sr = Math.min(48000, Math.max(500, Math.floor(sr)));
    const classic = !!classicCheckbox?.checked;
    const float = !!floatCheckbox?.checked;
    const params = new URLSearchParams(window.location.search);
    const payload = { code, sr, classic, float };
    params.set(PATCH_PARAM_KEY, encodePatchToBase64(payload));
    const query = params.toString();
    const newUrl = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
    window.history.replaceState(null, "", newUrl);
  } catch {
    // ignore URL serialization errors
  }
}

export interface InitialParams {
  initialCode: string | null;
  initialSampleRate: number | null;
  initialClassic: boolean | null;
  initialFloat: boolean | null;
}

export function loadFromUrl(): InitialParams | null {
  let initialCode: string | null = null;
  let initialSampleRate: number | null = null;
  let initialClassic: boolean | null = null;
  let initialFloat: boolean | null = null;

  try {
    const params = new URLSearchParams(window.location.search);
    const rawPatch = params.get(PATCH_PARAM_KEY);
    if (rawPatch) {
      const parsed = decodePatchFromBase64(rawPatch) as
          | {
        code?: unknown;
        sr?: unknown;
        classic?: unknown;
        float?: unknown;
      }
          | null;
      if (parsed) {
        if (typeof parsed.code === "string" && parsed.code.trim().length > 0) {
          initialCode = parsed.code;
        }
        if (typeof parsed.sr === "number" && Number.isFinite(parsed.sr)) {
          initialSampleRate = parsed.sr;
        }
        if (typeof parsed.classic === "boolean") {
          initialClassic = parsed.classic;
        }
        if (typeof parsed.float === "boolean") {
          initialFloat = parsed.float;
        }
      }
    }
  } catch {
    // ignore malformed URL patches
  }

  return {
    initialCode,
    initialSampleRate,
    initialClassic,
    initialFloat,
  }
}