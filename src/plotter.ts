import { expressionApi } from "./expression-api";
import { getEditorValue } from "./editor.ts";
import { extractExpressionFromCode } from "./expression-utils.ts";
import { floatCheckbox } from "./selectors.ts";

const plotsContainer = document.querySelector<HTMLDivElement>(
  "#bb-plots-container",
);

interface PlotConfig {
  evalFn: (t: number) => { sample: number; plots: number[] };
  windowSize: number;
  plotNames: string[];
}

function buildPlotPath(
  samples: number[],
  width: number,
  height: number,
): string {
  if (samples.length === 0) return "";

  let min = samples[0];
  let max = samples[0];
  for (const v of samples) {
    if (v < min) min = v;
    if (v > max) max = v;
  }

  const range = max - min || 1;
  const n = samples.length;
  let path = "";

  samples.forEach((value, index) => {
    const x = (index / Math.max(1, n - 1)) * width;
    const y = height - ((value - min) / range) * height;
    path += `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)} `;
  });

  return path.trim();
}

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

  const DEFAULT_WINDOW = 8000;
  return { evalFn, windowSize: DEFAULT_WINDOW, plotNames };
}

function renderPlots(series: Record<string, number[]>) {
  if (!plotsContainer) return;

  const entries = Object.entries(series);
  if (entries.length === 0) {
    plotsContainer.innerHTML = '<p class="bb-placeholder">No data to plot.</p>';
    return;
  }

  const width = 400;
  const height = 140;

  plotsContainer.innerHTML = entries
    .map(([name, samples]) => {
      if (!samples.length) {
        return `
        <section class="bb-plot">
          <header class="bb-plot-header">${name} (no data)</header>
        </section>`;
      }

      let min = samples[0];
      let max = samples[0];
      for (const v of samples) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const minLabel = Number.isFinite(min) ? min : 0;
      const maxLabel = Number.isFinite(max) ? max : 0;

      const path = buildPlotPath(samples, width, height);
      return `
        <section class="bb-plot">
          <header class="bb-plot-header">${name}<br /><span class="bb-plot-range">min: ${minLabel}</span><span class="bb-plot-range">max: ${maxLabel}</span></header>
          <svg viewBox="0 0 ${width} ${height}" class="bb-plot-svg" role="img" aria-label="Plot of ${name}">
            <path d="${path}" />
          </svg>
        </section>`;
    })
    .join("");
}

let currentPlotConfig: PlotConfig | null = null;
let plotAnimationId: number | null = null;
let lastPlotSampleRate = 8000;
let plotStartMs = performance.now();

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
  plotStartMs = performance.now();
  startRealtimePlot();
}

function realtimePlotLoop() {
  plotAnimationId = null;
  if (!currentPlotConfig) {
    plotAnimationId = window.requestAnimationFrame(realtimePlotLoop);
    return;
  }

  const { evalFn, windowSize, plotNames } = currentPlotConfig;
  const series: Record<string, number[]> = { sample: [] };
  const plotSeries: number[][] = [];

  const now = performance.now();
  const elapsedSeconds = (now - plotStartMs) / 1000;
  const baseT = Math.max(
    0,
    Math.floor(elapsedSeconds * lastPlotSampleRate) - windowSize + 1,
  );

  try {
    const isFloat = !!floatCheckbox?.checked;
    for (let i = 0; i < windowSize; i += 1) {
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
