/* -------------------------------------------------------------
   CONFIG
------------------------------------------------------------- */

const GLOBAL_DATA_URL = 'data/global_leachate_stats.json';

const PALETTES = {
  okabeIto: {
    name: 'Okabe–Ito',
    userRange: '#009E73',
    userValues: '#56B4E9',
    globalMedian: '#E69F00',
    globalRange: 'rgba(148,163,184,0.45)'
  },
  classic: {
    name: 'Classic',
    userRange: '#34d399',
    userValues: '#60a5fa',
    globalMedian: '#f59e0b',
    globalRange: 'rgba(148,163,184,0.40)'
  }
};

let currentPalette = PALETTES.okabeIto;
let GLOBAL_STATS = null;
let USER_ROWS = [];


/* -------------------------------------------------------------
   LOAD GLOBAL STATS + UPDATE BADGE
------------------------------------------------------------- */

async function loadGlobalStats() {
  const res = await fetch(GLOBAL_DATA_URL);
  GLOBAL_STATS = await res.json();

  document.getElementById('badgeName').innerText =
    GLOBAL_STATS?.db_name ?? 'Global Leachate DB';

  document.getElementById('badgeVersion').innerText =
    GLOBAL_STATS?.version ?? '—';
}


/* -------------------------------------------------------------
   CSV PARSING HELPERS
------------------------------------------------------------- */

function mapColumns(row) {
  const mapped = {};
  for (const k in row) {
    const key = k.trim();
    const val = row[k];
    const lower = key.toLowerCase();

    if (lower === 'sample') mapped.Sample = val;
    else if (lower === 'element') mapped.Element = String(val).trim();
    else if (lower === 'value') mapped.Value = parseFloat(val);
    else if (lower === 'min') mapped.Min = parseFloat(val);
    else if (lower === 'max') mapped.Max = parseFloat(val);
    else if (lower === 'magmatype' || lower === 'magma' || lower === 'composition')
      mapped.MagmaType = String(val).trim();
    else if (lower === 'method') mapped.Method = String(val).trim();
    else mapped[key] = val;
  }
  return mapped;
}

function parseFile(file) {
  return new Promise(resolve => {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: res =>
        resolve(res.data.map(mapColumns).filter(r => r.Element))
    });
  });
}

function parsePaste(text) {
  return new Promise(resolve => {
    Papa.parse(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: res =>
        resolve(res.data.map(mapColumns).filter(r => r.Element))
    });
  });
}


/* -------------------------------------------------------------
   PREVIEW TABLE
------------------------------------------------------------- */

function renderPreview(rows) {
  const preview = document.getElementById('preview');

  if (!rows.length) {
    preview.innerText = 'No data loaded yet.';
    return;
  }

  const head = ['Sample','Element','Value','Min','Max','MagmaType','Method'];
  const first = rows.slice(0, 8);

  let txt = 'Preview (first rows):\n' + head.join('\t') + '\n';
  for (const r of first) {
    txt += head.map(h => (r[h] ?? '')).join('\t') + '\n';
  }

  preview.innerText = txt;
}


/* -------------------------------------------------------------
   GET GLOBAL STAT BLOCK (best match)
------------------------------------------------------------- */

function getStats(element, comp, method) {
  const e = GLOBAL_STATS?.elements?.[element];
  if (!e) return null;

  const paths = [
    [comp, method],
    [comp, 'All'],
    ['All', method],
    ['All', 'All']
  ];

  for (const [c, m] of paths) {
    if (e[c] && e[c][m]) return e[c][m];
  }
  return null;
}


/* -------------------------------------------------------------
   ELEMENT SORTING
------------------------------------------------------------- */

function orderElements(elements, rows, comp, method, orderMode) {
  const info = {};

  for (const el of elements) {
    const stats = getStats(el, comp, method);

    const vals = rows
      .filter(r => r.Element === el && isFinite(r.Value))
      .map(r => r.Value);

    const userMedian = vals.length
      ? vals.sort((a,b)=>a-b)[Math.floor(vals.length/2)]
      : null;

    info[el] = {
      globalMedian: stats?.median ?? null,
      userMedian
    };
  }

  if (orderMode === 'alpha')
    return [...elements].sort((a,b)=>a.localeCompare(b));

  if (orderMode === 'revAlpha')
    return [...elements].sort((a,b)=>b.localeCompare(a));

  if (orderMode === 'globalMedian')
    return [...elements].sort(
      (a,b)=>(info[a].globalMedian ?? Infinity) - (info[b].globalMedian ?? Infinity)
    );

  if (orderMode === 'userValue')
    return [...elements].sort(
      (a,b)=>(info[a].userMedian ?? Infinity) - (info[b].userMedian ?? Infinity)
    );

  return elements;
}


/* -------------------------------------------------------------
   NORMALIZED PLOT
------------------------------------------------------------- */

function buildNormalizedTraces(rows, comp, method, orderMode) {
  const byEl = new Map();
  rows.forEach(r => {
    if (!byEl.has(r.Element)) byEl.set(r.Element, []);
    byEl.get(r.Element).push(r);
  });

  const elementList = orderElements(
    Array.from(byEl.keys()), rows, comp, method, orderMode
  );

  const traces = [];

  for (const el of elementList) {
    const arr = byEl.get(el);
    const stats = getStats(el, comp, method);
    if (!stats) continue;

    const gmin = stats.min, gmax = stats.max, gmed = stats.median;
    if (gmin == null || gmax == null || gmed == null) continue;

    const range = gmax - gmin;
    if (!(range > 0)) continue;

    let uMin = Infinity, uMax = -Infinity;
    const vals = [];

    for (const r of arr) {
      if (isFinite(r.Value)) {
        vals.push(r.Value);
        uMin = Math.min(uMin, r.Value);
        uMax = Math.max(uMax, r.Value);
      }
      if (isFinite(r.Min)) uMin = Math.min(uMin, r.Min);
      if (isFinite(r.Max)) uMax = Math.max(uMax, r.Max);
    }

    if (!isFinite(uMin) && !isFinite(uMax)) continue;

    const minNorm = ((uMin - gmin)/range)*100;
    const maxNorm = ((uMax - gmin)/range)*100;
    const medNorm = ((gmed - gmin)/range)*100;

    // Range
    traces.push({
      type: 'scatter',
      mode: 'lines',
      line: { width: 12, color: currentPalette.userRange },
      x: [minNorm, maxNorm],
      y: [el, el],
      name: 'Your range',
      hovertemplate: `${el}<br>Your range: ${minNorm.toFixed(1)}–${maxNorm.toFixed(1)} %<extra></extra>`
    });

    // Points
    if (vals.length) {
      traces.push({
        type: 'scatter',
        mode: 'markers',
        marker: { size: 8, color: currentPalette.userValues },
        x: vals.map(v=>((v-gmin)/range)*100),
        y: vals.map(()=>el),
        name: 'Your value(s)',
        hovertemplate: `${el}<br>Your value: %{x:.1f} %<extra></extra>`
      });
    }

    // Global median
    traces.push({
      type: 'scatter',
      mode: 'markers',
      marker: { size: 10, color: currentPalette.globalMedian, symbol: 'diamond' },
      x: [medNorm],
      y: [el],
      name: 'Global median',
      hovertemplate: `${el}<br>Global median: ${gmed}<extra></extra>`
    });
  }

  const layout = {
    title: 'Normalized position within global range',
    xaxis: { title: '% of global range', range: [0,100] },
    yaxis: { type: 'category', autorange: 'reversed' },
    plot_bgcolor: '#0c1425',
    paper_bgcolor: '#0c1425',
    hovermode: 'closest',
    margin: { l:120, r:20, t:40, b:50 }
  };

  return { traces, layout };
}


/* -------------------------------------------------------------
   ABSOLUTE PLOT
------------------------------------------------------------- */

function buildAbsoluteTraces(rows, comp, method, useLinear, orderMode) {
  const byEl = new Map();
  rows.forEach(r => {
    if (!byEl.has(r.Element)) byEl.set(r.Element, []);
    byEl.get(r.Element).push(r);
  });

  const elementList = orderElements(
    Array.from(byEl.keys()), rows, comp, method, orderMode
  );

  const traces = [];

  for (const el of elementList) {
    const arr = byEl.get(el);
    const stats = getStats(el, comp, method);
    if (!stats) continue;

    const gmin = stats.min, gmax = stats.max, gmed = stats.median;
    if (gmin == null || gmax == null || gmed == null) continue;

    let uMin = Infinity, uMax = -Infinity;
    const vals = [];

    for (const r of arr) {
      if (isFinite(r.Value)) {
        vals.push(r.Value);
        uMin = Math.min(uMin, r.Value);
        uMax = Math.max(uMax, r.Value);
      }
      if (isFinite(r.Min)) uMin = Math.min(uMin, r.Min);
      if (isFinite(r.Max)) uMax = Math.max(uMax, r.Max);
    }

    if (!isFinite(uMin) && !isFinite(uMax)) continue;

    // Global range
    traces.push({
      type: 'scatter',
      mode: 'lines',
      line: { width: 12, color: currentPalette.globalRange },
      x: [gmin, gmax],
      y: [el, el],
      name: 'Global range',
      hovertemplate: `${el}<br>Global range: ${gmin}–${gmax}<extra></extra>`
    });

    // User range
    if (isFinite(uMin) && isFinite(uMax)) {
      traces.push({
        type: 'scatter',
        mode: 'lines',
        line: { width: 12, color: currentPalette.userRange },
        x: [uMin, uMax],
        y: [el, el],
        name: 'Your range',
        hovertemplate: `${el}<br>Your range: ${uMin}–${uMax}<extra></extra>`
      });
    }

    // User values
    if (vals.length) {
      traces.push({
        type: 'scatter',
        mode: 'markers',
        marker: { size: 8, color: currentPalette.userValues },
        x: vals,
        y: vals.map(()=>el),
        name: 'Your value(s)',
        hovertemplate: `${el}<br>Your value: %{x}<extra></extra>`
      });
    }

    // Median
    traces.push({
      type: 'scatter',
      mode: 'markers',
      marker: { size: 10, color: currentPalette.globalMedian, symbol:'diamond' },
      x: [gmed],
      y: [el],
      name: 'Global median',
      hovertemplate: `${el}<br>Global median: ${gmed}<extra></extra>`
    });
  }

  const layout = {
    title: 'Absolute leachate values vs global distribution',
    xaxis: {
      title: `Concentration (${useLinear ? 'linear' : 'log'})`,
      type: useLinear ? 'linear' : 'log'
    },
    yaxis: { type: 'category', autorange: 'reversed' },
    plot_bgcolor: '#0c1425',
    paper_bgcolor: '#0c1425',
    hovermode: 'closest',
    margin: { l:120, r:20, t:40, b:50 }
  };

  return { traces, layout };
}


/* -------------------------------------------------------------
   METHODS PARAGRAPH
------------------------------------------------------------- */

function buildMethodsText(rows, comp, method) {
  const version = GLOBAL_STATS?.version ?? 'unknown';
  const dbName = GLOBAL_STATS?.db_name ?? 'Global Leachate DB';

  const elements = Array.from(new Set(rows.map(r => r.Element))).sort();

  return `
Volcanic ash leachate values were compared with the ${dbName} (version ${version}),
using element‑specific global minimum, median, and maximum values.
Filters: Magmatic composition = ${comp}; Leachate method = ${method}.
Normalized values were calculated using Min–Max scaling.
Absolute values were shown on log scale by default.
Elements included: ${elements.join(', ')}.
All computation was performed entirely in the browser; no data were uploaded or stored.
`.trim();
}


/* -------------------------------------------------------------
   MAIN EVENT BINDINGS
------------------------------------------------------------- */

async function main() {
  await loadGlobalStats();

  const fileInput = document.getElementById('file');
  const pasteBtn = document.getElementById('loadPaste');
  const pasteArea = document.getElementById('paste');

  const compSel = document.getElementById('compFilter');
  const methodSel = document.getElementById('methodFilter');
  const orderSel = document.getElementById('orderFilter');

  const genBtn = document.getElementById('generate');

  const plotNorm = document.getElementById('plotNormalized');
  const plotAbs = document.getElementById('plotAbsolute');

  const dlNorm = document.getElementById('dlNorm');
  const dlAbs = document.getElementById('dlAbs');

  const methodsOut = document.getElementById('methodsOut');
  const copyBtn = document.getElementById('copyMethods');

  const paletteSel = document.getElementById('paletteSel');
  const useLinearChk = document.getElementById('useLinear');
  const absScaleLabel = document.getElementById('absScaleLabel');

  /* --- INPUT HANDLERS --- */

  fileInput.addEventListener('change', async e => {
    const file = e.target.files[0];
    USER_ROWS = file ? await parseFile(file) : [];
    renderPreview(USER_ROWS);
  });

  pasteBtn.addEventListener('click', async () => {
    USER_ROWS = await parsePaste(pasteArea.value);
    renderPreview(USER_ROWS);
  });

  paletteSel.addEventListener('change', () => {
    currentPalette = PALETTES[paletteSel.value] || PALETTES.okabeIto;
  });

  useLinearChk.addEventListener('change', () => {
    absScaleLabel.innerText = useLinearChk.checked ? 'linear' : 'log';
  });

  /* --- GENERATE PLOTS --- */

  genBtn.addEventListener('click', async () => {
    if (!USER_ROWS.length) {
      document.getElementById('preview').innerText =
        'No data loaded. Upload a CSV or paste data first.';
      return;
    }

    const comp = compSel.value;
    const method = methodSel.value;
    const order = orderSel.value;

    const norm = buildNormalizedTraces(USER_ROWS, comp, method, order);
    const abs = buildAbsoluteTraces(USER_ROWS, comp, method, useLinearChk.checked, order);

    await Plotly.react(plotNorm, norm.traces, norm.layout);
    await Plotly.react(plotAbs, abs.traces, abs.layout);

    methodsOut.value = buildMethodsText(USER_ROWS, comp, method);
  });

  /* --- DOWNLOAD BUTTONS --- */

  dlNorm.addEventListener('click', () => {
    Plotly.downloadImage(plotNorm, {format:'png', filename:'leachate_normalized'});
  });

  dlAbs.addEventListener('click', () => {
    Plotly.downloadImage(plotAbs, {format:'png', filename:'leachate_absolute'});
  });

  /* --- COPY METHODS --- */

  copyBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(methodsOut.value);
      copyBtn.innerText = 'Copied!';
      setTimeout(() => copyBtn.innerText = 'Copy to clipboard', 1200);
    } catch {
      alert('Copy failed. Please select the text manually.');
    }
  });
}

main();
