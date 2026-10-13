/* Lead Router — score, qualify, and route leads entirely client-side. */
(function () {
  "use strict";

  // ---------- Reference data ----------
  const STATE_NAMES = {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
    connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
    hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
    louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
    mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
    "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
    ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
    "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
    virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  };
  const TERRITORIES = ["East", "Central", "West"];
  const SEGMENTS = ["SMB", "Mid-Market", "Enterprise"];
  const STORAGE_KEY = "leadRouter.rules.v1";

  const DEFAULT_RULES = {
    threshold: 50,
    titleTiers: [
      { name: "C-Level / Founder", keywords: "chief, ceo, cto, cfo, coo, cmo, cro, cio, founder, co-founder, president, owner", points: 30 },
      { name: "VP", keywords: "vp, vice president, svp, evp", points: 25 },
      { name: "Director / Head", keywords: "director, head of", points: 20 },
      { name: "Manager", keywords: "manager, lead", points: 10 },
      { name: "Everyone else", keywords: null, points: 3 },
    ],
    sizeBands: [
      { label: "1–49", min: 0, points: 5 },
      { label: "50–199", min: 50, points: 10 },
      { label: "200–999", min: 200, points: 20 },
      { label: "1,000–4,999", min: 1000, points: 25 },
      { label: "5,000+", min: 5000, points: 30 },
    ],
    industries: {
      "Software": { on: true, points: 15 },
      "Financial Services": { on: true, points: 15 },
      "Healthcare": { on: true, points: 10 },
      "Manufacturing": { on: false, points: 5 },
      "Retail": { on: false, points: 5 },
      "Education": { on: false, points: 5 },
      "Logistics": { on: false, points: 5 },
      "Media": { on: false, points: 5 },
    },
    sources: {
      "Demo Request": 25,
      "Referral": 20,
      "Trade Show": 12,
      "Webinar": 10,
      "Organic Search": 10,
      "Paid Search": 6,
      "Content Download": 8,
      "Cold Outbound": 3,
    },
    segments: { mmMin: 200, entMin: 1000 },
    territories: {
      East: "ME, NH, VT, MA, RI, CT, NY, NJ, PA, DE, MD, DC, VA, WV, NC, SC, GA, FL",
      Central: "OH, MI, IN, IL, WI, MN, IA, MO, ND, SD, NE, KS, OK, TX, AR, LA, MS, AL, TN, KY",
      West: "MT, WY, CO, NM, ID, UT, AZ, NV, CA, OR, WA, AK, HI",
    },
    reps: {
      East: { "SMB": "Jamie Ortiz", "Mid-Market": "Priya Raman", "Enterprise": "Morgan Hale" },
      Central: { "SMB": "Dev Thompson", "Mid-Market": "Alexis Brandt", "Enterprise": "Sam Whitaker" },
      West: { "SMB": "Riley Chen", "Mid-Market": "Taylor Brooks", "Enterprise": "Casey Navarro" },
    },
  };

  const $ = (sel) => document.querySelector(sel);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (n) => Number(n).toLocaleString();

  // ---------- State ----------
  let rules = loadRules();
  let leads = [];          // parsed input rows
  let scored = [];         // leads + score/routing
  let datasetName = "Sample data";
  const view = { search: "", status: "all", rep: "all", sortKey: "score", sortDir: "desc" };

  function loadRules() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && saved.titleTiers && saved.sizeBands) return Object.assign(clone(DEFAULT_RULES), saved);
    } catch (e) { /* storage unavailable or corrupt — fall back to defaults */ }
    return clone(DEFAULT_RULES);
  }
  function saveRules() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rules)); } catch (e) { /* ignore */ }
  }

  // ---------- CSV ----------
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => v.trim() !== ""));
  }

  const toCSVField = (v) => {
    const s = String(v ?? "");
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  const COLUMN_ALIASES = {
    name: ["name", "fullname", "leadname", "contactname", "contact"],
    first: ["firstname", "first", "givenname"],
    last: ["lastname", "last", "surname", "familyname"],
    title: ["title", "jobtitle", "role", "position"],
    company: ["company", "companyname", "account", "accountname", "organization", "org"],
    size: ["companysize", "size", "employees", "employeecount", "numberofemployees", "headcount", "numemployees"],
    industry: ["industry", "vertical", "sector"],
    source: ["leadsource", "source", "channel"],
    state: ["state", "stateprovince", "province", "region", "st"],
  };

  function rowsToLeads(rows) {
    if (rows.length < 2) throw new Error("The CSV needs a header row and at least one lead.");
    const header = rows[0].map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
    const idx = {};
    for (const [key, aliases] of Object.entries(COLUMN_ALIASES)) {
      idx[key] = header.findIndex((h) => aliases.includes(h));
    }
    const missing = [];
    if (idx.name < 0 && idx.first < 0) missing.push("name");
    for (const k of ["title", "size", "industry", "source", "state"]) if (idx[k] < 0) missing.push(k === "size" ? "company_size" : k === "source" ? "lead_source" : k);
    const get = (r, k) => (idx[k] >= 0 ? (r[idx[k]] || "").trim() : "");
    const out = rows.slice(1).map((r, i) => ({
      id: i,
      name: get(r, "name") || [get(r, "first"), get(r, "last")].filter(Boolean).join(" ") || "(no name)",
      title: get(r, "title"),
      company: get(r, "company"),
      sizeRaw: get(r, "size"),
      size: parseSize(get(r, "size")),
      industry: get(r, "industry"),
      source: get(r, "source"),
      state: normalizeState(get(r, "state")),
    }));
    return { leads: out, missing };
  }

  function parseSize(raw) {
    if (!raw) return null;
    const m = String(raw).toLowerCase().replace(/,/g, "").match(/(\d+(?:\.\d+)?)\s*(k|m)?/);
    if (!m) return null;
    let n = parseFloat(m[1]);
    if (m[2] === "k") n *= 1000;
    if (m[2] === "m") n *= 1000000;
    return Math.round(n);
  }

  function normalizeState(raw) {
    const s = raw.trim();
    if (!s) return "";
    if (s.length === 2) return s.toUpperCase();
    return STATE_NAMES[s.toLowerCase().replace(/\./g, "")] || s.toUpperCase();
  }

  // ---------- Scoring & routing ----------
  function keywordRegex(keywords) {
    const parts = keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean)
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return parts.length ? new RegExp("(^|[^a-z])(" + parts.join("|") + ")($|[^a-z])", "i") : null;
  }

  function buildMatchers() {
    const tiers = rules.titleTiers.map((t) => ({ ...t, re: t.keywords == null ? null : keywordRegex(t.keywords) }));
    const stateToTerritory = {};
    for (const t of TERRITORIES) {
      for (const st of (rules.territories[t] || "").split(/[\s,]+/)) {
        if (st) stateToTerritory[st.toUpperCase()] = t;
      }
    }
    return { tiers, stateToTerritory };
  }

  function scoreLead(lead, m) {
    const breakdown = [];
    // Title
    let tier = m.tiers.find((t) => t.re && t.re.test(lead.title));
    if (!tier) tier = m.tiers.find((t) => t.keywords == null);
    const titlePts = tier ? Number(tier.points) || 0 : 0;
    breakdown.push(["Title", tier ? tier.name : "—", titlePts]);
    // Size
    let band = null;
    if (lead.size != null) for (const b of rules.sizeBands) if (lead.size >= b.min) band = b;
    const sizePts = band ? Number(band.points) || 0 : 0;
    breakdown.push(["Size", band ? band.label : "Unknown", sizePts]);
    // Industry
    const ind = rules.industries[lead.industry];
    const indPts = ind && ind.on ? Number(ind.points) || 0 : 0;
    breakdown.push(["Industry", ind && ind.on ? "Target" : "Non-target", indPts]);
    // Source
    const srcPts = Number(rules.sources[lead.source]) || 0;
    breakdown.push(["Source", lead.source || "Unknown", srcPts]);

    const score = titlePts + sizePts + indPts + srcPts;
    const mql = score >= rules.threshold;
    const territory = m.stateToTerritory[lead.state] || "Unassigned";
    const size = lead.size ?? 0;
    const segment = size >= rules.segments.entMin ? "Enterprise" : size >= rules.segments.mmMin ? "Mid-Market" : "SMB";
    let rep = "";
    if (mql) rep = territory === "Unassigned" ? "Unassigned queue" : (rules.reps[territory]?.[segment] || "Unassigned queue");
    return { ...lead, score, mql, territory, segment, rep, breakdown };
  }

  function maxScore() {
    const max = (arr) => Math.max(0, ...arr.map(Number).filter((n) => !isNaN(n)));
    return max(rules.titleTiers.map((t) => t.points)) + max(rules.sizeBands.map((b) => b.points)) +
      max(Object.values(rules.industries).filter((i) => i.on).map((i) => i.points)) + max(Object.values(rules.sources));
  }

  function recompute() {
    const m = buildMatchers();
    scored = leads.map((l) => scoreLead(l, m));
    saveRules();
    renderKPIs();
    renderFunnel();
    renderRepFilter();
    renderTable();
  }

  // ---------- Rules panel ----------
  function numInput(value, onChange, attrs = "") {
    const el = document.createElement("span");
    el.className = "pts";
    el.innerHTML = `<input type="number" step="1" value="${esc(value)}" ${attrs}> pts`;
    el.querySelector("input").addEventListener("input", (e) => onChange(Number(e.target.value) || 0));
    return el;
  }

  function renderRules() {
    // Threshold
    const thr = $("#threshold");
    thr.max = Math.max(100, maxScore());
    thr.value = rules.threshold;
    $("#threshold-out").textContent = rules.threshold;

    // Title tiers
    const tWrap = $("#title-rules");
    tWrap.innerHTML = "";
    rules.titleTiers.forEach((t) => {
      const box = document.createElement("div");
      box.className = "title-tier";
      const row = document.createElement("div");
      row.className = "rule-row";
      row.innerHTML = `<div class="label"><span>${esc(t.name)}</span></div>`;
      row.appendChild(numInput(t.points, (v) => { t.points = v; onRulesChanged(); }, `aria-label="${esc(t.name)} points"`));
      box.appendChild(row);
      if (t.keywords != null) {
        const kw = document.createElement("input");
        kw.type = "text";
        kw.value = t.keywords;
        kw.setAttribute("aria-label", t.name + " keywords");
        kw.addEventListener("input", () => { t.keywords = kw.value; onRulesChanged(); });
        box.appendChild(kw);
      } else {
        const p = document.createElement("div");
        p.className = "hint";
        p.style.margin = "0";
        p.textContent = "Fallback when no keywords match";
        box.appendChild(p);
      }
      tWrap.appendChild(box);
    });

    // Size bands
    const sWrap = $("#size-rules");
    sWrap.innerHTML = "";
    rules.sizeBands.forEach((b) => {
      const row = document.createElement("div");
      row.className = "rule-row";
      row.innerHTML = `<div class="label"><span>${esc(b.label)} employees</span></div>`;
      row.appendChild(numInput(b.points, (v) => { b.points = v; onRulesChanged(); }, `aria-label="${esc(b.label)} points"`));
      sWrap.appendChild(row);
    });

    // Industries
    const iWrap = $("#industry-rules");
    iWrap.innerHTML = "";
    Object.keys(rules.industries).sort().forEach((name) => {
      const ind = rules.industries[name];
      const row = document.createElement("div");
      row.className = "rule-row" + (ind.on ? "" : " off");
      const id = "ind-" + name.replace(/\W+/g, "-");
      row.innerHTML = `<label class="label" for="${id}"><input type="checkbox" id="${id}" ${ind.on ? "checked" : ""}><span>${esc(name)}</span></label>`;
      row.querySelector("input").addEventListener("change", (e) => {
        ind.on = e.target.checked;
        row.classList.toggle("off", !ind.on);
        onRulesChanged();
      });
      row.appendChild(numInput(ind.points, (v) => { ind.points = v; onRulesChanged(); }, `aria-label="${esc(name)} points"`));
      iWrap.appendChild(row);
    });

    // Sources
    const srcWrap = $("#source-rules");
    srcWrap.innerHTML = "";
    Object.keys(rules.sources).sort((a, b) => rules.sources[b] - rules.sources[a] || a.localeCompare(b)).forEach((name) => {
      const row = document.createElement("div");
      row.className = "rule-row";
      row.innerHTML = `<div class="label"><span>${esc(name)}</span></div>`;
      row.appendChild(numInput(rules.sources[name], (v) => { rules.sources[name] = v; onRulesChanged(); }, `aria-label="${esc(name)} points"`));
      srcWrap.appendChild(row);
    });

    // Routing
    $("#mm-min").value = rules.segments.mmMin;
    $("#ent-min").value = rules.segments.entMin;
    const terrWrap = $("#territory-rules");
    terrWrap.innerHTML = "";
    TERRITORIES.forEach((t) => {
      const lab = document.createElement("label");
      lab.innerHTML = `${t}<input type="text" value="${esc(rules.territories[t])}">`;
      lab.querySelector("input").addEventListener("input", (e) => { rules.territories[t] = e.target.value; onRulesChanged(); });
      terrWrap.appendChild(lab);
    });
    const grid = $("#rep-grid");
    grid.innerHTML = `<span></span>` + SEGMENTS.map((s) => `<span class="hdr">${s}</span>`).join("");
    TERRITORIES.forEach((t) => {
      const h = document.createElement("span");
      h.className = "rowhdr";
      h.textContent = t;
      grid.appendChild(h);
      SEGMENTS.forEach((s) => {
        const inp = document.createElement("input");
        inp.type = "text";
        inp.value = rules.reps[t][s];
        inp.setAttribute("aria-label", `${t} ${s} rep`);
        inp.addEventListener("input", () => { rules.reps[t][s] = inp.value.trim() || `${t} ${s}`; onRulesChanged(); });
        grid.appendChild(inp);
      });
    });
  }

  let rafPending = false;
  function onRulesChanged() {
    $("#threshold").max = Math.max(100, maxScore());
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; recompute(); });
  }

  // Make sure every industry/source seen in the data has a rule row.
  function absorbDataValues() {
    for (const l of leads) {
      if (l.industry && !rules.industries[l.industry]) rules.industries[l.industry] = { on: false, points: 5 };
      if (l.source && !(l.source in rules.sources)) rules.sources[l.source] = 0;
    }
  }

  // ---------- KPIs ----------
  function renderKPIs() {
    const total = scored.length;
    const mqls = scored.filter((l) => l.mql);
    const avg = total ? Math.round(scored.reduce((s, l) => s + l.score, 0) / total) : 0;
    const byRep = countByRep(mqls);
    const top = byRep.filter((r) => r.rep !== "Unassigned queue")[0];
    const reps = byRep.filter((r) => r.count > 0 && r.rep !== "Unassigned queue").length;
    const kpi = (label, value, sub) => `<div class="kpi"><div class="k-label">${label}</div><div class="k-value">${value}</div><div class="k-sub">${sub}</div></div>`;
    $("#kpis").innerHTML =
      kpi("Total leads", fmt(total), esc(datasetName)) +
      kpi("MQLs", fmt(mqls.length), total ? `${Math.round((mqls.length / total) * 100)}% of leads · threshold ${rules.threshold}` : "—") +
      kpi("Avg. score", avg, `out of ${maxScore()} possible`) +
      kpi("Reps receiving MQLs", reps, top && top.count ? `Most: ${esc(top.rep)} (${top.count})` : "No MQLs routed");
  }

  function countByRep(mqls) {
    const map = new Map();
    for (const t of TERRITORIES) for (const s of SEGMENTS) {
      const name = rules.reps[t][s];
      if (!map.has(name)) map.set(name, { rep: name, territory: t, segment: s, count: 0, scoreSum: 0, cells: [] });
      map.get(name).cells.push(`${t} ${s}`);
    }
    for (const l of mqls) {
      if (!map.has(l.rep)) map.set(l.rep, { rep: l.rep, territory: "—", segment: "—", count: 0, scoreSum: 0, cells: ["State not in a territory"] });
      const r = map.get(l.rep);
      r.count++;
      r.scoreSum += l.score;
    }
    return [...map.values()]
      .filter((r) => r.rep !== "Unassigned queue" || r.count > 0)
      .sort((a, b) => b.count - a.count || a.rep.localeCompare(b.rep));
  }

  // ---------- Funnel ----------
  function renderFunnel() {
    const el = $("#funnel");
    const total = scored.length;
    if (!total) { el.innerHTML = `<div class="f-empty">Upload a CSV to see the funnel.</div>`; return; }
    const mqls = scored.filter((l) => l.mql);
    const reps = countByRep(mqls);
    const pct = (n) => (total ? (n / total) * 100 : 0);
    const row = (label, sub, n, cls, tip) =>
      `<div class="f-row"><div class="f-label" title="${esc(label)}">${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ""}</div>` +
      `<div class="f-track" data-tip="${esc(JSON.stringify(tip))}"><div class="f-bar ${cls}" style="width:calc(${pct(n)}% * 0.82)"></div>` +
      `<span class="f-val"><b>${fmt(n)}</b>${tip.rate ? " · " + tip.rate : ""}</span></div></div>`;

    let html = "";
    html += row("Total leads", "", total, "s1", { title: "Total leads", rows: [["Leads", fmt(total)]] });
    const mqlRate = Math.round((mqls.length / total) * 100) + "%";
    html += row("MQLs", `score ≥ ${rules.threshold}`, mqls.length, "s2",
      { title: "Marketing-qualified leads", rate: mqlRate, rows: [["MQLs", fmt(mqls.length)], ["Conversion from total", mqlRate], ["Nurture", fmt(total - mqls.length)]] });
    html += `<div class="f-divider"></div><div class="f-group">Routed by rep</div>`;
    for (const r of reps) {
      const share = mqls.length ? Math.round((r.count / mqls.length) * 100) + "%" : "0%";
      html += row(r.rep, r.cells.join(", "), r.count, "s3", {
        title: r.rep,
        rate: r.count ? share + " of MQLs" : "",
        rows: [["Coverage", r.cells.join(", ")], ["MQLs routed", fmt(r.count)], ["Share of MQLs", share], ["Avg. MQL score", r.count ? Math.round(r.scoreSum / r.count) : "—"]],
      });
    }
    el.innerHTML = html;
    el.setAttribute("aria-label", `Funnel: ${total} total leads, ${mqls.length} MQLs, ` +
      reps.map((r) => `${r.rep} ${r.count}`).join(", "));
  }

  function setupTooltip() {
    const tip = $("#funnel-tip");
    const funnel = $("#funnel");
    funnel.addEventListener("mousemove", (e) => {
      const track = e.target.closest(".f-track");
      if (!track) { tip.hidden = true; return; }
      const d = JSON.parse(track.dataset.tip);
      tip.innerHTML = `<div class="t-title">${esc(d.title)}</div>` +
        d.rows.map(([k, v]) => `<div class="t-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
      tip.hidden = false;
      const w = tip.offsetWidth, h = tip.offsetHeight;
      let x = e.clientX + 14, y = e.clientY + 14;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - 14;
      if (y + h > window.innerHeight - 8) y = e.clientY - h - 14;
      tip.style.left = x + "px";
      tip.style.top = y + "px";
    });
    funnel.addEventListener("mouseleave", () => { tip.hidden = true; });
  }

  // ---------- Table ----------
  function renderRepFilter() {
    const sel = $("#filter-rep");
    const reps = [...new Set(scored.filter((l) => l.mql).map((l) => l.rep))].sort();
    if (view.rep !== "all" && !reps.includes(view.rep)) view.rep = "all";
    sel.innerHTML = `<option value="all">All reps</option>` + reps.map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("");
    sel.value = view.rep;
  }

  function filteredRows() {
    const q = view.search.toLowerCase();
    let rows = scored.filter((l) =>
      (view.status === "all" || (view.status === "mql") === l.mql) &&
      (view.rep === "all" || l.rep === view.rep) &&
      (!q || [l.name, l.company, l.title, l.industry, l.source, l.state, l.rep].some((v) => (v || "").toLowerCase().includes(q))));
    const k = view.sortKey, dir = view.sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      let x = a[k], y = b[k];
      if (k === "mql") { x = a.mql ? 1 : 0; y = b.mql ? 1 : 0; }
      if (typeof x === "number" || typeof y === "number") return ((x ?? -1) - (y ?? -1)) * dir || b.score - a.score;
      return String(x || "").localeCompare(String(y || "")) * dir || b.score - a.score;
    });
    return rows;
  }

  function renderTable() {
    const rows = filteredRows();
    const tbody = $("#results tbody");
    const max = Math.max(1, maxScore());
    $("#table-count").textContent = `Showing ${rows.length} of ${scored.length} leads · hover a score for its breakdown`;
    if (!rows.length) {
      tbody.innerHTML = `<tr class="empty-row"><td colspan="12">No leads match these filters.</td></tr>`;
    } else {
      tbody.innerHTML = rows.map((l) => {
        const bd = l.breakdown.map(([k, v, p]) => `${k}: ${v} (+${p})`).join("\n");
        return `<tr>
          <td class="name">${esc(l.name)}</td>
          <td>${esc(l.company)}</td>
          <td class="muted">${esc(l.title)}</td>
          <td class="num" title="${esc(bd)}"><span class="score"><span class="score-bar"><i style="width:${Math.min(100, (l.score / max) * 100)}%"></i></span><b>${l.score}</b></span></td>
          <td><span class="pill ${l.mql ? "mql" : "nurture"}">${l.mql ? "MQL" : "Nurture"}</span></td>
          <td>${l.mql ? `<span class="rep-name">${esc(l.rep)}</span>` : `<span class="rep-none">—</span>`}</td>
          <td>${esc(l.segment)}</td>
          <td>${esc(l.territory)}</td>
          <td class="num">${l.size != null ? fmt(l.size) : `<span class="rep-none">${esc(l.sizeRaw || "—")}</span>`}</td>
          <td class="muted">${esc(l.industry)}</td>
          <td class="muted">${esc(l.source)}</td>
          <td>${esc(l.state)}</td>
        </tr>`;
      }).join("");
    }
    document.querySelectorAll("#results th").forEach((th) => {
      if (th.dataset.key === view.sortKey) th.setAttribute("aria-sort", view.sortDir === "asc" ? "ascending" : "descending");
      else th.removeAttribute("aria-sort");
    });
  }

  function exportCSV() {
    const header = ["name", "title", "company", "company_size", "industry", "lead_source", "state", "score", "status", "segment", "territory", "routed_to"];
    const lines = [header.join(",")].concat(filteredRows().map((l) =>
      [l.name, l.title, l.company, l.size ?? l.sizeRaw, l.industry, l.source, l.state, l.score, l.mql ? "MQL" : "Nurture", l.segment, l.territory, l.rep]
        .map(toCSVField).join(",")));
    download("routed-leads.csv", lines.join("\n") + "\n");
  }

  function download(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Loading data ----------
  let toastTimer;
  function toast(msg, isError) {
    const t = $("#toast");
    t.textContent = msg;
    t.className = "toast" + (isError ? " error" : "");
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3000);
  }

  function loadCSVText(text, name) {
    try {
      const { leads: parsed, missing } = rowsToLeads(parseCSV(text));
      leads = parsed;
      datasetName = name;
      $("#dataset-label").textContent = `${name} · ${fmt(leads.length)} leads`;
      absorbDataValues();
      renderRules();
      recompute();
      if (missing.length) toast(`Loaded ${leads.length} leads — missing column(s): ${missing.join(", ")}. Those fields score 0.`, true);
      else if (name !== "Sample data") toast(`Loaded ${fmt(leads.length)} leads from ${name}`);
    } catch (err) {
      toast(err.message || "Could not read that CSV.", true);
    }
  }

  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadCSVText(String(reader.result), file.name);
    reader.onerror = () => toast("Could not read that file.", true);
    reader.readAsText(file);
  }

  // ---------- Wire up ----------
  function init() {
    $("#file-input").addEventListener("change", (e) => { readFile(e.target.files[0]); e.target.value = ""; });
    $("#load-sample").addEventListener("click", () => loadCSVText(window.SAMPLE_CSV, "Sample data"));
    $("#download-sample").addEventListener("click", () => download("sample-leads.csv", window.SAMPLE_CSV));
    $("#reset-rules").addEventListener("click", () => {
      rules = clone(DEFAULT_RULES);
      absorbDataValues();
      renderRules();
      recompute();
      toast("Rules reset to defaults");
    });
    $("#threshold").addEventListener("input", (e) => {
      rules.threshold = Number(e.target.value);
      $("#threshold-out").textContent = rules.threshold;
      onRulesChanged();
    });
    $("#mm-min").addEventListener("input", (e) => { rules.segments.mmMin = Number(e.target.value) || 0; onRulesChanged(); });
    $("#ent-min").addEventListener("input", (e) => { rules.segments.entMin = Number(e.target.value) || 0; onRulesChanged(); });
    $("#search").addEventListener("input", (e) => { view.search = e.target.value; renderTable(); });
    $("#filter-status").addEventListener("change", (e) => { view.status = e.target.value; renderTable(); });
    $("#filter-rep").addEventListener("change", (e) => { view.rep = e.target.value; renderTable(); });
    $("#export").addEventListener("click", exportCSV);
    document.querySelectorAll("#results th").forEach((th) => th.addEventListener("click", () => {
      const k = th.dataset.key;
      if (view.sortKey === k) view.sortDir = view.sortDir === "asc" ? "desc" : "asc";
      else { view.sortKey = k; view.sortDir = ["score", "size", "mql"].includes(k) ? "desc" : "asc"; }
      renderTable();
    }));

    // Drag & drop anywhere on the page
    const overlay = $("#drop-overlay");
    let depth = 0;
    window.addEventListener("dragenter", (e) => { if (e.dataTransfer?.types.includes("Files")) { depth++; overlay.hidden = false; } });
    window.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; overlay.hidden = true; } });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => {
      e.preventDefault();
      depth = 0;
      overlay.hidden = true;
      readFile(e.dataTransfer?.files?.[0]);
    });

    setupTooltip();
    loadCSVText(window.SAMPLE_CSV, "Sample data");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
