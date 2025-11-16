import { getEditorValue } from "./editor.ts";
import { extractExpressionFromCode } from "./expression-utils.ts";
import { floatCheckbox } from "./selectors.ts";
import { getAudioCurrentTime } from "./audio-state.ts";

const expressionApi = `const abs = Math.abs;
const sin = Math.sin;
const cos = Math.cos;
const tan = Math.tan;
const asin = Math.asin;
const acos = Math.acos;
const atan = Math.atan;
const tanh = Math.tanh;
const floor = Math.floor;
const ceil = Math.ceil;
const round = Math.round;
const sqrt = Math.sqrt;
const log = Math.log;
const exp = Math.exp;
const pow = Math.pow;
const PI = Math.PI;
const TAU = Math.PI * 2;
const min = Math.min;
const max = Math.max;
const random = Math.random;`;

const WINDOW_SIZE = 8000;

const plotsContainer = document.querySelector<HTMLDivElement>(
  "#bb-plots-container",
);

interface PlotConfig {
  evalFn: (t: number) => { sample: number; plots: number[] };
  plotNames: string[];
}

type PlotCanvasEntry = {
  container: HTMLElement;
  header: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
};

const plotCanvases = new Map<string, PlotCanvasEntry>();

function buildPlotConfig(code: string): PlotConfig | null {
  const expression = extractExpressionFromCode(code);

  if (!expression) {
    return null;
  }

  const plotNames: string[] = [];

  function collectPlotNames(expr: string) {
    for (let i = 0; i < expr.length; i += 1) {
      if (expr.startsWith("plot(", i)) {
        let depth = 0;
        const start = i + "plot(".length;
        let end = start;
        for (let j = start; j < expr.length; j += 1) {
          const ch = expr[j];
          if (ch === "(") depth += 1;
          else if (ch === ")") {
            if (depth === 0) {
              end = j;
              break;
            }
            depth -= 1;
          }
        }

        const arg = expr.slice(start, end);
        // Collect names for any nested plot() inside the argument first
        collectPlotNames(arg);

        const raw = arg.trim();
        plotNames.push(raw || `plot ${plotNames.length + 1}`);

        i = end;
      }
    }
  }

  collectPlotNames(expression);

  const fnBody = `
${expressionApi}
plotState.values.length = 0;
plotState.index = 0;
function plot(x) {
  const idx = plotState.index++;
  plotState.values[idx] = Number(x) || 0;
  return x;
}
const sample = (${expression});
return { sample: Number(sample) || 0, plots: plotState.values.slice() };
`;

  let inner: (
    t: number,
    plotState: { values: number[]; index: number },
  ) => {
    sample: number;
    plots: number[];
  };

  try {
    inner = new Function("t", "plotState", fnBody) as typeof inner;
  } catch (error) {
    console.error("Failed to compile plot function", error, fnBody);
    return null;
  }

  const evalFn = (t: number) => {
    const state = { values: [] as number[], index: 0 };
    return inner(t, state);
  };

  return { evalFn, plotNames };
}

function drawSeriesOnCanvas(
  entry: PlotCanvasEntry,
  name: string,
  samples: number[],
  width: number,
  height: number,
) {
  const { header, ctx, canvas } = entry;

  if (!samples.length) {
    header.textContent = `${name} (no data)`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  let min = samples[0];
  let max = samples[0];
  for (const v of samples) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const minLabel = Number.isFinite(min) ? min : 0;
  const maxLabel = Number.isFinite(max) ? max : 0;

  header.innerHTML = `${name}<br /><span class="bb-plot-range">min: ${minLabel}</span><span class="bb-plot-range">max: ${maxLabel}</span>`;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const range = max - min || 1;
  const n = samples.length;

  const step = Math.max(1, Math.floor(n / width));

  ctx.beginPath();
  ctx.strokeStyle = "#0ff";
  ctx.lineWidth = 1;

  let first = true;
  for (let i = 0; i < n; i += step) {
    const value = samples[i];
    const x = (i / Math.max(1, n - 1)) * width;
    const y = height - ((value - min) / range) * height;

    if (first) {
      ctx.moveTo(x, y);
      first = false;
    } else {
      ctx.lineTo(x, y);
    }
  }

  ctx.stroke();
}

function renderPlots(series: Record<string, number[]>) {
  if (!plotsContainer) return;

  const entries = Object.entries(series);
  if (entries.length === 0) {
    plotsContainer.innerHTML = '<p class="bb-placeholder">No data to plot.</p>';
    plotCanvases.clear();
    return;
  }

  const width = 400;
  const height = 80;

  for (const [name, samples] of entries) {
    let entry = plotCanvases.get(name);

    if (!entry) {
      const section = document.createElement("section");
      section.className = "bb-plot";

      const header = document.createElement("header");
      header.className = "bb-plot-header";
      section.appendChild(header);

      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.className = "bb-plot-canvas";
      section.appendChild(canvas);

      plotsContainer.appendChild(section);

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        continue;
      }

      entry = { container: section, header, canvas, ctx };
      plotCanvases.set(name, entry);
    }

    if (entry.container.parentElement !== plotsContainer) {
      plotsContainer.appendChild(entry.container);
    }

    drawSeriesOnCanvas(entry, name, samples, width, height);
  }

  for (const key of Array.from(plotCanvases.keys())) {
    if (!series[key]) {
      const entry = plotCanvases.get(key);
      if (entry && entry.container.parentElement === plotsContainer) {
        plotsContainer.removeChild(entry.container);
      }
      plotCanvases.delete(key);
    }
  }
}

let currentPlotConfig: PlotConfig | null = null;
let plotAnimationId: number | null = null;
let lastPlotSampleRate = 8000;
let lastRenderTime = 0;
const TARGET_INTERVAL_MS = 1000 / 30; // ~30 FPS cap for plotting

function startRealtimePlot() {
  if (!plotAnimationId) {
    plotAnimationId = window.requestAnimationFrame(realtimePlotLoop);
  }
}

export function stopRealtimePlot() {
  if (plotAnimationId !== null) {
    window.cancelAnimationFrame(plotAnimationId);
    plotAnimationId = null;
  }
}

export function updatePlotConfigFromCode(targetSampleRate: number) {
  const code = getEditorValue();
  currentPlotConfig = buildPlotConfig(code);
  lastPlotSampleRate = targetSampleRate;
  startRealtimePlot();
}

function realtimePlotLoop(timestamp: number) {
  plotAnimationId = null;

  if (timestamp - lastRenderTime < TARGET_INTERVAL_MS) {
    plotAnimationId = window.requestAnimationFrame(realtimePlotLoop);
    return;
  }
  lastRenderTime = timestamp;

  if (!currentPlotConfig) {
    plotAnimationId = window.requestAnimationFrame(realtimePlotLoop);
    return;
  }

  const { evalFn, plotNames } = currentPlotConfig;
  const series: Record<string, number[]> = { sample: [] };
  const plotSeries: number[][] = [];

  const elapsedSeconds = getAudioCurrentTime();
  const baseT = Math.max(
    0,
    Math.floor(elapsedSeconds * lastPlotSampleRate) - WINDOW_SIZE + 1,
  );

  try {
    const isFloat = !!floatCheckbox?.checked;
    const maxPoints = 800; // limit computation and plotting per frame
    const step = Math.max(1, Math.floor(WINDOW_SIZE / maxPoints));

    for (let i = 0; i < WINDOW_SIZE; i += step) {
      const t = baseT + i;
      const tArg = isFloat ? t / lastPlotSampleRate : t;
      const { sample, plots } = evalFn(tArg);
      if (isFloat) {
        const s = Number(sample) || 0;
        series.sample.push(s);
      } else {
        const sampleByte = (Number(sample) || 0) & 0xff;
        series.sample.push(sampleByte);
      }
      for (let idx = 0; idx < plots.length; idx += 1) {
        if (!plotSeries[idx]) plotSeries[idx] = [];
        plotSeries[idx].push(Number(plots[idx]) || 0);
      }
    }
  } catch (error) {
    console.error("Error during realtime plotting", error);
    if (plotAnimationId !== null) {
      window.cancelAnimationFrame(plotAnimationId);
      plotAnimationId = null;
    }
    return;
  }

  plotSeries.forEach((values, idx) => {
    const name = plotNames[idx] ?? `plot ${idx + 1}`;
    series[name] = values;
  });

  renderPlots(series);

  plotAnimationId = window.requestAnimationFrame(realtimePlotLoop);
}
