
(function () {
  "use strict";
  var CFG = window.TU_COMPARE_CONFIG;
  if (!CFG || !document.getElementById("tu-view-compare")) return;

  var T = CFG.theme, FONT = CFG.font, MAX = CFG.palette.length;
  var DATA = window.TU_COMPARE_DATA = window.TU_COMPARE_DATA || {};
  var byId = {}, groups = [], metricByCol = {};
  CFG.sites.forEach(function (s) {
    byId[s.id] = s;
    if (groups.indexOf(s.group) === -1) groups.push(s.group);
  });
  CFG.metrics.forEach(function (m) { metricByCol[m.col] = m; });

  var state = { group: groups[0], selected: [], slots: {}, metrics: CFG.defaults.slice(), year: "all", started: false };
  var loading = {}, failed = {}, plotlyStatus = window.Plotly ? "ready" : "idle";

  function $(id) { return document.getElementById(id); }

  function h(tag, props, kids) {
    var e = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      var v = props[k];
      if (v === false || v === null || v === undefined) return;
      if (k === "text") e.textContent = v;
      else if (k === "class") e.className = v;
      else if (k.indexOf("on") === 0) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) {
      if (c !== null && c !== undefined) e.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return e;
  }

  function colorOf(id) { return CFG.palette[state.slots[id]]; }
  function dashOf(id) { return (CFG.dashes && CFG.dashes[state.slots[id]]) || "solid"; }
  // A small line sample in the site's color and line pattern (or a dashed
  // gray placeholder for a site that isn't ticked).
  function swatch(id) {
    if (!id) return h("span", { class: "tu-swatch is-empty", "aria-hidden": "true" });
    return h("span", { class: "tu-swatch is-" + dashOf(id), style: "--c:" + colorOf(id), "aria-hidden": "true" });
  }
  // The same sample as text, for the end-of-line labels inside the chart.
  var GLYPH = String.fromCharCode(0x2501), DOT = String.fromCharCode(0x2022);
  function lineGlyph(id) {
    var d = dashOf(id);
    if (d === "dot") return DOT + " " + DOT + " " + DOT;
    if (d === "dash") return GLYPH + " " + GLYPH;
    if (d === "dashdot") return GLYPH + " " + DOT + " " + GLYPH;
    return GLYPH + GLYPH;
  }
  function toMs(s) { return Date.parse(String(s).replace(" ", "T") + "Z"); }
  function msStr(ms) { return new Date(ms).toISOString().replace("T", " ").slice(0, 19); }
  function fmt(v) { return v === null || v === undefined || isNaN(v) ? "n/a" : Number(v).toFixed(2); }
  function appliesTo(col, type) { var m = metricByCol[col]; return !!m && m.types.indexOf(type) !== -1; }
  function escapeText(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function hexToRgba(hex, a) {
    var m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
    return m ? "rgba(" + parseInt(m[1], 16) + "," + parseInt(m[2], 16) + "," + parseInt(m[3], 16) + "," + a + ")" : hex;
  }

  // ---- loading the chart library and each site's data, on demand ----------
  function loadScript(src, onload, onerror) {
    var s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = onload;
    s.onerror = onerror;
    document.head.appendChild(s);
  }
  function ensurePlotly() {
    if (window.Plotly) { plotlyStatus = "ready"; return; }
    if (plotlyStatus !== "idle") return;
    plotlyStatus = "loading";
    loadScript(CFG.plotlySrc,
      function () { plotlyStatus = window.Plotly ? "ready" : "failed"; render(); },
      function () { plotlyStatus = "failed"; render(); });
  }
  function ensureData(id) {
    if (DATA[id] || loading[id] || failed[id]) return;
    loading[id] = true;
    loadScript(encodeURIComponent(id) + "/compare-data.js",
      function () { loading[id] = false; if (!DATA[id]) failed[id] = true; render(); },
      function () { loading[id] = false; failed[id] = true; render(); });
  }
  function hasMetric(id, col) {
    var d = DATA[id], v = d && d.metrics[col];
    if (!v) return false;
    for (var i = 0; i < v.length; i++) if (v[i] !== null) return true;
    return false;
  }
  function msDates(id) {
    var d = DATA[id];
    if (!d._ms) d._ms = d.dates.map(toMs);
    return d._ms;
  }

  // ---- provisional data (approved_through in the R SETTINGS) ------------------
  // Readings after a site's approved-through date sit on a light band; where
  // the sites shown were approved to different dates, the band is lighter
  // until the last of them and names the sites still provisional there.
  var PROV_ALL = "rgba(247,248,245,0.08)", PROV_SOME = "rgba(247,248,245,0.05)", PROV_EDGE = "rgba(247,248,245,0.45)";
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function fmtDay(ms) { var d = new Date(ms); return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear(); }
  function cutoffMs(id, col) {
    var a = byId[id] && byId[id].approved, s = a && !Array.isArray(a) ? a[col] : null;
    return s ? toMs(s) : null;
  }
  // First and last reading times of one metric at one site.
  function span(id, col) {
    var d = DATA[id];
    d._span = d._span || {};
    if (!d._span[col]) {
      var t = msDates(id), v = d.metrics[col] || [], first = null, last = null;
      for (var j = 0; j < t.length; j++) if (v[j] !== null) { if (first === null) first = t[j]; last = t[j]; }
      d._span[col] = { first: first, last: last };
    }
    return d._span[col];
  }
  // A site's approved-through date for a metric, only when it has readings after it.
  function provFrom(id, col) {
    var c = cutoffMs(id, col);
    if (c === null || !DATA[id] || !hasMetric(id, col)) return null;
    return span(id, col).last > c ? c : null;
  }
  // One metric panel's bands: one per distinct approved-through date among
  // the sites shown, running to the next such date (or the end of the
  // window), each listing the sites still provisional in it.
  function bandSegments(ids, col, win) {
    var withM = ids.filter(function (id) { return hasMetric(id, col); });
    var cuts = [];
    withM.forEach(function (id) { var c = provFrom(id, col); if (c !== null && cuts.indexOf(c) === -1) cuts.push(c); });
    cuts.sort(function (a, b) { return a - b; });
    return cuts.map(function (c, j) {
      var prov = withM.filter(function (id) { var p = provFrom(id, col); return p !== null && p <= c; });
      return { start: Math.max(c, win[0]), end: j + 1 < cuts.length ? cuts[j + 1] : win[1],
               edge: c > win[0] ? c : null, all: prov.length === withM.length, ids: prov };
    }).filter(function (s) { return s.end > s.start; });
  }
  // " (provisional)" / " (partly provisional)" for a Year selector entry,
  // judged on the ticked metrics of the sites selected.
  function yearSuffix(r0, r1) {
    var pairs = [];
    state.selected.forEach(function (id) {
      if (!DATA[id]) return;
      CFG.metrics.forEach(function (m) {
        if (state.metrics.indexOf(m.col) === -1 || !hasMetric(id, m.col)) return;
        var sp = span(id, m.col);
        if (sp.first > r1 || sp.last < r0) return;
        pairs.push({ c: cutoffMs(id, m.col), first: sp.first, last: sp.last });
      });
    });
    if (!pairs.some(function (p) { return p.c !== null && p.c < Math.min(r1, p.last); })) return "";
    var all = pairs.every(function (p) { return p.c !== null && p.c < Math.max(r0, p.first); });
    return all ? " (provisional)" : " (partly provisional)";
  }

  // ---- selection -------------------------------------------------------------
  function addSite(id) {
    if (state.selected.indexOf(id) !== -1 || state.selected.length >= MAX || !byId[id]) return;
    var used = state.selected.map(function (s) { return state.slots[s]; });
    var slot = 0;
    while (used.indexOf(slot) !== -1) slot++;
    state.selected.push(id);
    state.slots[id] = slot;
    // A site whose kind has none of the ticked metrics (e.g. a well added while
    // only Streamflow is on) gets its kind's default metric switched on, so it
    // shows up on the chart instead of silently missing.
    var type = byId[id].type;
    if (!state.metrics.some(function (c) { return appliesTo(c, type); })) {
      var def = CFG.defaults.filter(function (c) { return appliesTo(c, type); })[0] ||
        (CFG.metrics.filter(function (m) { return m.types.indexOf(type) !== -1; })[0] || {}).col;
      if (def) state.metrics.push(def);
    }
  }
  function toggleSite(id) {
    var at = state.selected.indexOf(id);
    if (at !== -1) {
      state.selected.splice(at, 1);
      delete state.slots[id];
    } else {
      addSite(id);
    }
    render();
  }
  function toggleMetric(col) {
    var at = state.metrics.indexOf(col);
    if (at !== -1) state.metrics.splice(at, 1); else state.metrics.push(col);
    render();
  }
  function availableMetrics() {
    return CFG.metrics.filter(function (m) {
      return state.selected.some(function (id) { return m.types.indexOf(byId[id].type) !== -1; });
    });
  }

  // ---- time window and Year selector -----------------------------------------
  function unionWindow() {
    var lo = Infinity, hi = -Infinity;
    state.selected.forEach(function (id) {
      var d = DATA[id];
      if (!d) return;
      lo = Math.min(lo, toMs(d.bounds[0]));
      hi = Math.max(hi, toMs(d.bounds[1]));
    });
    return lo < hi ? [lo, hi] : null;
  }
  function waterYearOf(ms) { var d = new Date(ms); return d.getUTCMonth() >= 9 ? d.getUTCFullYear() + 1 : d.getUTCFullYear(); }
  function clip(r, win) { var a = Math.max(r[0], win[0]), b = Math.min(r[1], win[1]); return a < b ? [a, b] : null; }
  function yearOptions(win) {
    var out = [{ id: "all", label: "All Years", range: win }];
    if (!win) return out;
    // Same views as a site page's Water Year dropdown: Jan-Dec of the water
    // year's number, clipped to the data (or the official Oct-Sep year when
    // Jan-Dec misses the data entirely).
    for (var wy = waterYearOf(win[1]); wy >= waterYearOf(win[0]); wy--) {
      var r = clip([Date.UTC(wy, 0, 1), Date.UTC(wy, 11, 31, 23, 59, 59)], win) ||
              clip([Date.UTC(wy - 1, 9, 1), Date.UTC(wy, 8, 30, 23, 59, 59)], win);
      if (r) out.push({ id: "wy" + wy, range: r,
        label: "WY" + wy + yearSuffix(Date.UTC(wy - 1, 9, 1), Date.UTC(wy, 8, 30, 23, 59, 59)) });
    }
    return out;
  }

  // ---- controls ------------------------------------------------------------------
  function renderControls() {
    var gs = $("tu-cmp-group");
    if (!gs.options.length) groups.forEach(function (g) { gs.appendChild(h("option", { value: g, text: g })); });
    gs.value = state.group;

    var full = state.selected.length >= MAX;
    var siteBox = $("tu-cmp-sites");
    siteBox.textContent = "";
    CFG.sites.filter(function (s) { return s.group === state.group; }).forEach(function (s) {
      var on = state.selected.indexOf(s.id) !== -1, off = !on && full;
      var cb = h("input", { type: "checkbox", "data-key": "site:" + s.id, disabled: off,
        style: "accent-color:" + (on ? colorOf(s.id) : T.muted) });
      cb.checked = on;
      cb.addEventListener("change", function () { toggleSite(s.id); });
      siteBox.appendChild(h("label", { class: "tu-chip" + (on ? " is-on" : "") + (off ? " is-disabled" : ""), title: s.label },
        [cb, swatch(on ? s.id : null), h("span", { text: s.id })]));
    });

    var selBox = $("tu-cmp-selected");
    selBox.textContent = "";
    state.selected.forEach(function (id) {
      selBox.appendChild(h("button", { type: "button", class: "tu-chip is-on", "data-key": "remove:" + id,
        "aria-label": "Remove " + id + " from the comparison", title: byId[id].label,
        onclick: function () { toggleSite(id); } },
        [swatch(id), h("span", { text: id }), h("span", { class: "tu-chip-group", text: byId[id].group }),
         h("span", { class: "tu-chip-x", "aria-hidden": "true", text: String.fromCharCode(0xd7) })]));
    });
    $("tu-cmp-selected-field").hidden = state.selected.length === 0;
    var fullNote = $("tu-cmp-full");
    fullNote.hidden = !full;
    fullNote.textContent = MAX + " of " + MAX + " sites selected. Remove one to add another.";

    var metBox = $("tu-cmp-metrics");
    metBox.textContent = "";
    var avail = availableMetrics();
    avail.forEach(function (m) {
      var on = state.metrics.indexOf(m.col) !== -1;
      var cb = h("input", { type: "checkbox", "data-key": "metric:" + m.col, style: "accent-color:" + T.label });
      cb.checked = on;
      cb.addEventListener("change", function () { toggleMetric(m.col); });
      metBox.appendChild(h("label", { class: "tu-chip" + (on ? " is-on" : "") }, [cb, h("span", { text: m.label })]));
    });
    $("tu-cmp-metrics-field").hidden = avail.length === 0;

    var years = yearOptions(unionWindow());
    if (!years.some(function (o) { return o.id === state.year; })) state.year = "all";
    var ys = $("tu-cmp-year");
    ys.textContent = "";
    years.forEach(function (o) { ys.appendChild(h("option", { value: o.id, text: o.label })); });
    ys.value = state.year;
    return years;
  }

  function renderLegend() {
    var box = $("tu-cmp-legend");
    box.textContent = "";
    state.selected.forEach(function (id) {
      box.appendChild(h("span", null, [swatch(id), byId[id].label]));
    });
  }
  // Keys for the provisional bands on the chart, after the site keys.
  function renderBandLegend(kinds) {
    var box = $("tu-cmp-legend");
    if (kinds.all) box.appendChild(h("span", null,
      [h("span", { class: "tu-band-swatch", "aria-hidden": "true" }), CFG.provisionalLabel || "Provisional"]));
    if (kinds.some) box.appendChild(h("span", null,
      [h("span", { class: "tu-band-swatch is-some", "aria-hidden": "true" }), "Provisional for some sites"]));
  }

  // ---- chart -------------------------------------------------------------------
  var cmpBounds = null, yLockAtDragStart = null, xWidthAtDragStart = null, correctingPan = false, labelFrame = null;

  function yAxisKeys(gd) { return Object.keys(gd.layout).filter(function (k) { return /^yaxis\d*$/.test(k); }); }

  // Same drag behavior as the site pages: a click-drag pan leaves every
  // y-axis where it was (scroll-zoom, box-zoom and Reset axes still move
  // them), the time axis can't leave the data window, and a drag pushed
  // against an edge keeps its width instead of quietly zooming in.
  function attachDomListeners(gd) {
    if (gd._tuDomListeners) return;
    gd._tuDomListeners = true;
    gd.addEventListener("mousedown", function (ev) {
      if (!gd._fullLayout || ev.target.closest(".modebar")) return;
      if (gd._fullLayout.dragmode !== "pan") return;
      yLockAtDragStart = {};
      yAxisKeys(gd).forEach(function (k) {
        yLockAtDragStart[k] = gd.layout[k] && gd.layout[k].range ? gd.layout[k].range.slice() : null;
      });
      var ax = gd._fullLayout.xaxis;
      var onPlotArea = ev.target.classList && ev.target.classList.contains("nsewdrag");
      xWidthAtDragStart = onPlotArea && ax && ax.range ? ax.r2l(ax.range[1]) - ax.r2l(ax.range[0]) : null;
    });
    document.addEventListener("mouseup", function () {
      setTimeout(function () { yLockAtDragStart = null; xWidthAtDragStart = null; }, 150);
    });
  }

  function attachPlotlyListeners(gd) {
    correctingPan = false;
    gd.on("plotly_relayout", function (ev) {
      if (correctingPan) { correctingPan = false; return; }
      if (gd._fullLayout.dragmode !== "pan" || yLockAtDragStart === null) return;
      var revert = {}, changed = false;
      yAxisKeys(gd).forEach(function (k) {
        var cur = gd.layout[k] && gd.layout[k].range, lock = yLockAtDragStart[k];
        if (cur && lock && (cur[0] !== lock[0] || cur[1] !== lock[1])) { revert[k + ".range"] = lock.slice(); changed = true; }
      });
      if (changed) { correctingPan = true; Plotly.relayout(gd, revert); }
    });
    gd.on("plotly_relayout", function () {
      if (!cmpBounds) return;
      var ax = gd._fullLayout.xaxis;
      if (!ax || !ax.range) return;
      var lo = ax.r2l(ax.range[0]), hi = ax.r2l(ax.range[1]);
      var bLo = ax.r2l(cmpBounds[0]), bHi = ax.r2l(cmpBounds[1]), slack = 1000, nLo = null, nHi = null;
      if (lo < bLo - slack || hi > bHi + slack) {
        nLo = Math.max(lo, bLo); nHi = Math.min(hi, bHi);
        if (nLo >= nHi) { nLo = bLo; nHi = bHi; }
      } else if (xWidthAtDragStart !== null && gd._fullLayout.dragmode === "pan" &&
                 (hi - lo) < xWidthAtDragStart - slack && (lo <= bLo + slack || hi >= bHi - slack)) {
        var w = Math.min(xWidthAtDragStart, bHi - bLo);
        if (lo <= bLo + slack) { nLo = bLo; nHi = bLo + w; } else { nHi = bHi; nLo = bHi - w; }
      }
      if (nLo !== null) Plotly.relayout(gd, { "xaxis.range": [ax.l2r(nLo), ax.l2r(nHi)] });
    });
    // End-of-line site labels follow the view: re-placed after every pan/zoom.
    gd.on("plotly_relayout", function (ev) {
      if (ev && Object.keys(ev).length === 1 && ev.annotations !== undefined) return;
      if (labelFrame) cancelAnimationFrame(labelFrame);
      labelFrame = requestAnimationFrame(function () { labelFrame = null; updateEndLabels(gd); });
    });
  }

  // A label at the right edge of each panel naming each site's line, at the
  // line's last value in view; labels that would overlap are spread apart.
  function updateEndLabels(gd) {
    var meta = gd._tuMeta, L = gd._fullLayout;
    if (!meta || !L || !L.xaxis) return;
    var x0 = L.xaxis.r2l(L.xaxis.range[0]), x1 = L.xaxis.r2l(L.xaxis.range[1]);
    var anns = [], prevSig = null;
    meta.metrics.forEach(function (m, i) {
      var key = i === 0 ? "yaxis" : "yaxis" + (i + 1), ref = i === 0 ? "y" : "y" + (i + 1), ax = L[key];
      if (!ax) return;
      // Provisional band labels, at the top-left of each band in view. A
      // panel whose bands match the panel above it is left unlabeled.
      var segs = (meta.bands && meta.bands[i]) || [];
      var sig = segs.map(function (s) { return s.start + ":" + s.ids.join(","); }).join("|");
      if (sig !== prevSig) {
        segs.forEach(function (s) {
          var a = Math.max(s.start, x0), b = Math.min(s.end, x1);
          if (b <= a) return;
          var text = s.all ? (CFG.provisionalLabel || "Provisional") : s.ids.join(", ") + " provisional";
          if (L.xaxis.l2p(b) - L.xaxis.l2p(a) < text.length * 6.5 + 16) return;
          anns.push({ xref: "paper", x: (a - x0) / (x1 - x0), xanchor: "left", xshift: 4,
            yref: "paper", y: ax.domain[1], yanchor: "top", yshift: -4, showarrow: false,
            text: escapeText(text), bgcolor: hexToRgba(T.bg, 0.8),
            font: { family: FONT, color: T.text, size: 11 } });
        });
      }
      prevSig = sig;
      var items = [];
      meta.ids.forEach(function (id) {
        if (!hasMetric(id, m.col)) return;
        var t = msDates(id), v = DATA[id].metrics[m.col];
        for (var j = t.length - 1; j >= 0; j--) {
          if (t[j] > x1 || v[j] === null) continue;
          if (t[j] < x0) break;
          items.push({ id: id, value: v[j], px: ax.l2p(v[j]) });
          break;
        }
      });
      items.sort(function (a, b) { return a.px - b.px; });
      var pos = items.map(function (it) { return it.px; });
      for (var k = 1; k < pos.length; k++) if (pos[k] - pos[k - 1] < 16) pos[k] = pos[k - 1] + 16;
      var over = pos.length ? pos[pos.length - 1] - (ax._length - 8) : 0;
      if (over > 0) pos = pos.map(function (p) { return Math.max(8, p - over); });
      items.forEach(function (it, k) {
        anns.push({ xref: "paper", x: 1, xanchor: "left", xshift: 8, yref: ref, y: it.value, yanchor: "middle",
          yshift: -(pos[k] - it.px), showarrow: false, align: "left",
          text: '<span style="color:' + colorOf(it.id) + '">' + lineGlyph(it.id) + '</span> ' + it.id,
          font: { family: FONT, color: T.text, size: 12 } });
      });
    });
    Plotly.relayout(gd, { annotations: anns });
  }

  function drawChart(ids, metrics, win, view) {
    var gd = $("tu-cmp-chart");
    var n = metrics.length, gap = 0.012, mt = 20, mb = 70;
    var plotPx = Math.max(n, 4) * CFG.panelHeight;
    var traces = [], shapes = [], bands = [], kinds = { all: false, some: false };
    var layout = {
      height: plotPx + mt + mb, margin: { l: 90, r: 96, t: mt, b: mb },
      paper_bgcolor: T.bg, plot_bgcolor: T.bg, font: { family: FONT, color: T.text },
      showlegend: false, hovermode: "x unified", dragmode: "pan",
      hoverlabel: { bgcolor: T.panel, bordercolor: T.border, font: { family: FONT, color: T.text, size: 12 } }
    };
    metrics.forEach(function (m, i) {
      var top = 1 - i / n - (i === 0 ? 0 : gap / 2), bottom = 1 - (i + 1) / n + (i === n - 1 ? 0 : gap / 2);
      var key = i === 0 ? "yaxis" : "yaxis" + (i + 1), ref = i === 0 ? "y" : "y" + (i + 1);
      layout[key] = { domain: [bottom, top], anchor: "x", gridcolor: T.grid, zeroline: false, fixedrange: false,
        title: { text: m.label, font: { family: FONT, color: T.text, size: 12 } },
        tickfont: { family: FONT, color: T.text, size: 10 } };
      if (m.reverse) layout[key].autorange = "reversed";
      shapes.push({ type: "rect", xref: "paper", yref: "paper", x0: 0, x1: 1, y0: bottom, y1: top,
        line: { color: T.border, width: 1.2 }, fillcolor: "rgba(0,0,0,0)", layer: "above" });
      if (i < n - 1) shapes.push({ type: "line", xref: "paper", yref: "paper", x0: 0, x1: 1,
        y0: bottom - gap / 2, y1: bottom - gap / 2, line: { color: T.border, width: 0.75 } });
      var segs = bandSegments(ids, m.col, win);
      bands.push(segs);
      segs.forEach(function (s) {
        shapes.push({ type: "rect", xref: "x", yref: ref + " domain", x0: msStr(s.start), x1: msStr(s.end),
          y0: 0, y1: 1, fillcolor: s.all ? PROV_ALL : PROV_SOME, line: { width: 0 }, layer: "below" });
        if (s.edge !== null) shapes.push({ type: "line", xref: "x", yref: ref + " domain", x0: msStr(s.edge),
          x1: msStr(s.edge), y0: 0, y1: 1, line: { color: PROV_EDGE, width: 1 }, layer: "below" });
        if (s.all) kinds.all = true; else kinds.some = true;
      });
      ids.forEach(function (id) {
        if (!hasMetric(id, m.col)) return;
        var tr = { x: DATA[id].dates, y: DATA[id].metrics[m.col], type: "scatter", mode: "lines",
          name: id, xaxis: "x", yaxis: ref, connectgaps: false, showlegend: false,
          line: { color: colorOf(id), width: dashOf(id) === "solid" ? 1.8 : 2.2, dash: dashOf(id) },
          hovertemplate: "<b>" + id + "</b>  " + m.label + ": %{y:.2f}<extra></extra>" };
        // Provisional readings say so when hovered.
        var pc = provFrom(id, m.col);
        if (pc !== null) {
          tr.customdata = msDates(id).map(function (t) { return t > pc ? " (provisional)" : ""; });
          tr.hovertemplate = "<b>" + id + "</b>  " + m.label + ": %{y:.2f}%{customdata}<extra></extra>";
        }
        traces.push(tr);
      });
    });
    renderBandLegend(kinds);
    var bounds = [msStr(win[0]), msStr(win[1])];
    layout.shapes = shapes;
    layout.xaxis = { anchor: n === 1 ? "y" : "y" + n, gridcolor: T.grid, fixedrange: false,
      tickfont: { family: FONT, color: T.text, size: 10 },
      range: [msStr(view[0]), msStr(view[1])], minallowed: bounds[0], maxallowed: bounds[1],
      rangeslider: { visible: true, thickness: 0.08, bgcolor: T.bg, range: bounds.slice() } };
    cmpBounds = bounds;
    gd._tuMeta = { ids: ids, metrics: metrics, bands: bands };
    gd.style.height = layout.height + "px";
    attachDomListeners(gd);
    Plotly.newPlot(gd, traces, layout, { scrollZoom: true, displaylogo: false, responsive: true,
      modeBarButtonsToRemove: ["zoomIn2d", "zoomOut2d", "select2d", "lasso2d"] })
      .then(function () { updateEndLabels(gd); });
    attachPlotlyListeners(gd);
  }

  // ---- summary table ---------------------------------------------------------
  function stats(id, col, r0, r1) {
    if (!hasMetric(id, col)) return null;
    var t = msDates(id), v = DATA[id].metrics[col], mn = Infinity, mx = -Infinity, latest = null, latestT = null;
    for (var j = 0; j < t.length; j++) {
      if (v[j] === null || t[j] < r0 || t[j] > r1) continue;
      if (v[j] < mn) mn = v[j];
      if (v[j] > mx) mx = v[j];
      latest = v[j];
      latestT = t[j];
    }
    return latest === null ? null : { latest: latest, latestT: latestT, min: mn, max: mx };
  }
  function renderSummary(ids, metrics, yr) {
    var box = $("tu-cmp-summary");
    box.textContent = "";
    if (!ids.length || !metrics.length || !yr || !yr.range) {
      box.appendChild(h("p", { class: "tu-muted", text: "Latest, lowest and highest values for each selected site appear here." }));
      return;
    }
    metrics.forEach(function (m) {
      var sec = h("section", { class: "tu-stat" }, [h("h3", { text: m.label + ", " + yr.label })]);
      sec.appendChild(h("div", { class: "tu-stat-head" },
        [h("span", { text: "Site" }), h("span", { text: "Latest" }), h("span", { text: "Min" }), h("span", { text: "Max" })]));
      // Only sites that measure this metric at all (a well isn't listed under
      // Streamflow); one with no readings in the chosen year shows n/a.
      // Each site's approved-through date sits under its ID; a note says
      // when the latest value shown is provisional.
      var listed = ids.filter(function (id) { return hasMetric(id, m.col); }), provLatest = [];
      listed.forEach(function (id) {
        var st = stats(id, m.col, yr.range[0], yr.range[1]), c = cutoffMs(id, m.col);
        if (st && c !== null && st.latestT > c) provLatest.push(id);
        sec.appendChild(h("div", { class: "tu-stat-row" }, [
          h("span", { class: "tu-stat-site", title: byId[id].label }, [swatch(id), h("span", { text: id })]),
          h("span", { class: "tu-strong", text: st ? fmt(st.latest) : "n/a" }),
          h("span", { text: st ? fmt(st.min) : "n/a" }),
          h("span", { text: st ? fmt(st.max) : "n/a" }),
          c !== null ? h("span", { class: "tu-stat-sub", text: "Approved through " + fmtDay(c) }) : null]));
      });
      if (provLatest.length) {
        sec.appendChild(h("p", { class: "tu-stat-note", text: (provLatest.length === listed.length
          ? "Latest values are" : "Latest values for " + provLatest.join(", ") + " are") + " provisional, subject to revision." }));
      }
      box.appendChild(sec);
    });
  }

  // ---- main render -----------------------------------------------------------
  function showProblem(text) {
    $("tu-cmp-chart").hidden = true;
    var msg = $("tu-cmp-message");
    msg.hidden = false;
    msg.textContent = text;
  }
  function updateHash() {
    if ($("tu-view-compare").hidden) return;
    var hash = "#compare" + (state.selected.length ? "=" + state.selected.map(encodeURIComponent).join(",") : "");
    if (location.hash !== hash) history.replaceState(null, "", hash);
  }

  function render() {
    if ($("tu-view-compare").hidden) return;
    var active = document.activeElement, focusKey = active && active.getAttribute && active.getAttribute("data-key");
    var years = renderControls();
    if (focusKey) {
      var again = document.querySelector('[data-key="' + (window.CSS && CSS.escape ? CSS.escape(focusKey) : focusKey) + '"]');
      if (again) again.focus();
    }
    renderLegend();
    updateHash();

    var sel = state.selected;
    sel.forEach(ensureData);
    var drawable = sel.filter(function (id) { return !!DATA[id]; });
    var metrics = CFG.metrics.filter(function (m) {
      return state.metrics.indexOf(m.col) !== -1 && drawable.some(function (id) { return hasMetric(id, m.col); });
    });
    var yr = years.filter(function (o) { return o.id === state.year; })[0] || years[0];
    $("tu-cmp-title").textContent = sel.length ? "Comparing " + sel.join(", ") + ", " + yr.label : "Compare sites";
    $("tu-cmp-notes").textContent = sel.filter(function (id) { return failed[id]; })
      .map(function (id) { return "Couldn't load the data for " + id + "."; }).join(" ");

    var problem = null;
    if (!sel.length) problem = "Tick up to " + MAX + " sites to compare. Use the Watershed list to add sites from other watersheds or the wells.";
    else if (plotlyStatus === "failed") problem = "The chart library (lib/plotly.min.js) couldn't be loaded.";
    else if (plotlyStatus !== "ready" || sel.some(function (id) { return !DATA[id] && !failed[id]; })) problem = "Loading...";
    else if (!drawable.length) problem = "None of the selected sites' data could be loaded.";
    else if (!unionWindow()) problem = "The selected sites don't have enough readings to chart.";
    else if (!metrics.length) problem = state.metrics.length
      ? "None of the selected sites have readings for the ticked metric(s)."
      : "Tick at least one metric to show.";
    if (problem) {
      showProblem(problem);
      renderSummary([], [], null);
      return;
    }
    $("tu-cmp-message").hidden = true;
    $("tu-cmp-chart").hidden = false;
    drawChart(drawable, metrics, unionWindow(), yr.range);
    renderSummary(drawable, metrics, yr);
  }

  // ---- tabs and start-up -----------------------------------------------------
  function showView(which) {
    var compare = which === "compare";
    $("tu-view-single").hidden = compare;
    $("tu-view-compare").hidden = !compare;
    $("tu-tab-single").setAttribute("aria-pressed", compare ? "false" : "true");
    $("tu-tab-compare").setAttribute("aria-pressed", compare ? "true" : "false");
    if (compare) {
      if (!state.started) {
        state.started = true;
        if (!state.selected.length) {
          CFG.sites.filter(function (s) { return s.group === state.group; }).slice(0, Math.min(MAX, CFG.defaultCount || 3))
            .forEach(function (s) { addSite(s.id); });
        }
      }
      ensurePlotly();
      render();
    } else if (location.hash.indexOf("#compare") === 0) {
      history.replaceState(null, "", location.pathname + location.search);
    }
  }

  $("tu-tab-single").addEventListener("click", function () { showView("single"); });
  $("tu-tab-compare").addEventListener("click", function () { showView("compare"); });
  $("tu-cmp-group").addEventListener("change", function (e) { state.group = e.target.value; render(); });
  $("tu-cmp-year").addEventListener("change", function (e) { state.year = e.target.value; render(); });

  // A link ending in #compare=AP01,SC02 opens straight to that comparison.
  var m = /^#compare(?:=(.*))?$/.exec(location.hash);
  if (m) {
    var wanted = [];
    try { wanted = (m[1] || "").split(",").map(decodeURIComponent); } catch (e) { wanted = []; }
    wanted.filter(function (id) { return !!byId[id]; }).slice(0, MAX).forEach(addSite);
    if (state.selected.length) state.group = byId[state.selected[0]].group;
    state.started = state.selected.length > 0;   // a bare #compare still gets the default pick
    showView("compare");
  }
})();
