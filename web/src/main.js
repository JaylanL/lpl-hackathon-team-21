import "./style.css";
import { startDictation } from "./dictation.js";
import { GLOSSARY, tagTerms } from "./glossary.js";

// ---------- config ----------
let CFG = { apiUrl: "", region: "us-east-1", identityPoolId: "" };
const api = (path) => CFG.apiUrl.replace(/\/$/, "") + path;
async function post(path, body = {}) {
  const r = await fetch(api(path), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || data.error || `HTTP ${r.status}`);
  return data;
}

// ---------- i18n ----------
const T = {
  en: {
    tagline: "Find your advisor. Walk in ready.", tabInvestor: "Investor", tabAdvisor: "Advisor", tabDashboard: "Business dashboard",
    prefSimple: "Explain simply", prefLarge: "Larger text", prefContrast: "High contrast", prefRead: "Read replies aloud",
    investorTitle: "Let's find the right advisor for you",
    investorLead: "Answer a few quick questions by typing or speaking. It takes about 3 minutes, and there are no wrong answers.",
    starter1: "I'm new to investing and want help getting started", starter2: "I want to buy a house in 5 years but I have student loans",
    msgLabel: "Your message", msgPh: "Type or tap the mic and speak…", send: "Send",
    matchesTitle: "Your matches", matchesEmpty: "Your top 3 advisors will appear here, with the reasons each one fits you.",
    advisorTitle: "New prospects", advisorLead: "Matched clients arrive with a briefing, so the first meeting starts with their goals, not paperwork. Designed to drop into ClientWorks.",
    dashTitle: "Prospect-to-client funnel", dashLead: "Every intake is measured, so impact is visible, not claimed.", refresh: "Refresh",
    roiTitle: "Business impact calculator (illustrative)", roiNote: "Move the sliders to model scenarios. Assumptions are inputs, not forecasts.",
    greeting: "Hi! I'm Advisor Match. I'll ask a few short questions and then show you advisors who fit you. To start: what's one money goal you have right now?",
    readAloud: "Read aloud", thinking: "Thinking…", listening: "Listening… speak now. Tap the mic again to stop.",
    micStart: "Start speaking", micStop: "Stop speaking", choose: "Choose this advisor", verify: "Verify on FINRA BrokerCheck",
    booked: "You're booked!", with: "with", when: "When", chooseMsg: (n) => `I'd like to meet with ${n}.`,
    matchesAnnounce: (n) => `${n} advisors matched`,
    error: "Sorry, something went wrong. Please try again.",
  },
  es: {
    tagline: "Encuentre a su asesor. Llegue preparado.", tabInvestor: "Inversionista", tabAdvisor: "Asesor", tabDashboard: "Panel de negocio",
    prefSimple: "Explicar fácil", prefLarge: "Texto más grande", prefContrast: "Alto contraste", prefRead: "Leer respuestas en voz alta",
    investorTitle: "Encontremos al asesor ideal para usted",
    investorLead: "Responda unas preguntas escribiendo o hablando. Toma unos 3 minutos y no hay respuestas incorrectas.",
    starter1: "Soy nuevo en inversiones y quiero ayuda para empezar", starter2: "Quiero comprar una casa en 5 años pero tengo préstamos estudiantiles",
    msgLabel: "Su mensaje", msgPh: "Escriba o toque el micrófono y hable…", send: "Enviar",
    matchesTitle: "Sus asesores", matchesEmpty: "Aquí aparecerán sus 3 mejores asesores y por qué le convienen.",
    advisorTitle: "Nuevos prospectos", advisorLead: "Los clientes llegan con un resumen, así la primera reunión empieza con sus metas.",
    dashTitle: "Embudo de prospecto a cliente", dashLead: "Cada registro se mide: el impacto se ve.", refresh: "Actualizar",
    roiTitle: "Calculadora de impacto (ilustrativa)", roiNote: "Mueva los controles para modelar escenarios.",
    greeting: "¡Hola! Soy Advisor Match. Le haré unas preguntas cortas y luego le mostraré asesores ideales para usted. Para empezar: ¿cuál es una meta de dinero que tiene ahora?",
    readAloud: "Leer en voz alta", thinking: "Pensando…", listening: "Escuchando… hable ahora. Toque el micrófono otra vez para parar.",
    micStart: "Empezar a hablar", micStop: "Dejar de hablar", choose: "Elegir este asesor", verify: "Verificar en FINRA BrokerCheck",
    booked: "¡Cita reservada!", with: "con", when: "Cuándo", chooseMsg: (n) => `Me gustaría reunirme con ${n}.`,
    matchesAnnounce: (n) => `${n} asesores encontrados`,
    error: "Lo siento, algo salió mal. Intente de nuevo.",
  },
};
const state = { lang: "en", simple: false, autoread: false, sessionId: null, busy: false, dictation: null };
const t = (k) => T[state.lang][k] ?? T.en[k];

function applyI18n() {
  document.documentElement.lang = state.lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll("[data-i18n-ph]").forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  $("#mic").setAttribute("aria-label", state.dictation ? t("micStop") : t("micStart"));
}

// ---------- tiny safe markdown ----------
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function md(text) {
  const lines = esc(text).split(/\n/);
  let html = "", list = null;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|\W)\*(.+?)\*(?=\W|$)/g, "$1<em>$2</em>");
  for (const raw of lines) {
    const line = raw.trim();
    const ul = line.match(/^[-*•]\s+(.*)/), ol = line.match(/^\d+[.)]\s+(.*)/);
    const want = ul ? "ul" : ol ? "ol" : null;
    if (list && want !== list) { html += `</${list}>`; list = null; }
    if (want) { if (!list) { html += `<${want}>`; list = want; } html += `<li>${inline((ul || ol)[1])}</li>`; continue; }
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) html += `<p><strong>${inline(h[1])}</strong></p>`;
    else if (line) html += `<p>${inline(line)}</p>`;
  }
  if (list) html += `</${list}>`;
  return html;
}
const plain = (s) => s.replace(/\*\*|__|#+\s|[*_`]/g, "").replace(/^\s*[-•]\s+/gm, "");

let termTipId = 0;
function tagGlossaryTerms(html, text) {
  const matches = tagTerms(text);
  if (!matches.length) return html;

  // Walk Markdown's HTML text nodes, mapping their escaped text back to the
  // source string so inline formatting and block structure remain intact.
  const root = document.createElement("div");
  root.innerHTML = html;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);

  let rawCursor = 0;
  let matchIndex = 0;
  for (const node of nodes) {
    const sourceText = node.nodeValue;
    let sourceStart = text.indexOf(sourceText, rawCursor);
    if (sourceStart < 0) continue;
    rawCursor = sourceStart + sourceText.length;
    const fragments = document.createDocumentFragment();
    let cursor = 0;
    while (matchIndex < matches.length) {
      const match = matches[matchIndex];
      if (match.start < sourceStart) { matchIndex++; continue; }
      if (match.start >= sourceStart + sourceText.length) break;
      const start = match.start - sourceStart;
      const end = match.end - sourceStart;
      fragments.append(document.createTextNode(sourceText.slice(cursor, start)));
      const id = `tip-${++termTipId}`;
      const button = document.createElement("button");
      button.className = "term";
      button.setAttribute("aria-describedby", id);
      button.setAttribute("aria-expanded", "false");
      button.type = "button";
      button.textContent = sourceText.slice(start, end);
      const tip = document.createElement("span");
      tip.id = id;
      tip.setAttribute("role", "tooltip");
      tip.className = "term-tip";
      tip.hidden = true;
      tip.textContent = GLOSSARY[match.term][state.lang] || GLOSSARY[match.term].en;
      fragments.append(button, tip);
      cursor = end;
      matchIndex++;
    }
    fragments.append(document.createTextNode(sourceText.slice(cursor)));
    node.replaceWith(fragments);
  }
  return root.innerHTML;
}

// ---------- DOM helpers ----------
const $ = (s) => document.querySelector(s);
const chat = () => $("#chat");
function addMsg(role, text, opts = {}) {
  const div = document.createElement("div");
  div.className = `msg ${role}${opts.cls ? " " + opts.cls : ""}`;
  div.innerHTML = role === "bot" && !opts.cls ? tagGlossaryTerms(md(text), text) : `<p>${esc(text)}</p>`;
  if (role === "bot" && !opts.cls) {
    const b = document.createElement("button");
    b.className = "speak";
    b.type = "button";
    b.textContent = "🔊 " + t("readAloud");
    b.setAttribute("aria-label", t("readAloud"));
    b.onclick = () => speak(text);
    div.appendChild(b);
  }
  chat().appendChild(div);
  chat().scrollTop = chat().scrollHeight;
  return div;
}

let audioEl = null;
async function speak(text) {
  try {
    const { audio_b64 } = await post("/speak", { text: plain(text), lang: state.lang });
    if (audioEl) audioEl.pause();
    audioEl = new Audio("data:audio/mpeg;base64," + audio_b64);
    await audioEl.play();
  } catch (e) { console.warn("[speak]", e); }
}

// ---------- chat ----------
async function send(text) {
  text = (text || "").trim();
  if (!text || state.busy) return;
  stopDictation();
  state.busy = true;
  $("#send").disabled = true;
  $("#starters").hidden = true;
  addMsg("user", text);
  $("#msg").value = "";
  const typing = addMsg("bot", t("thinking"), { cls: "typing" });
  try {
    const res = await post("/chat", { message: text, session_id: state.sessionId, simple: state.simple, lang: state.lang });
    state.sessionId = res.session_id;
    typing.remove();
    addMsg("bot", res.reply || "…");
    if (res.matches) renderMatches(res.matches);
    if (res.booking) renderBooking(res.booking, res.briefing);
    if (state.autoread) speak(res.reply);
  } catch (e) {
    typing.remove();
    addMsg("bot", `${t("error")} (${e.message})`, { cls: "error" });
  } finally {
    state.busy = false;
    $("#send").disabled = false;
    $("#msg").focus();
  }
}

function renderMatches(list) {
  $("#matches-announcement").textContent = t("matchesAnnounce")(list.length);
  const box = $("#matches");
  box.innerHTML = "";
  list.forEach((a) => {
    const card = document.createElement("article");
    card.className = "match";
    card.innerHTML = `
      <h3>${esc(a.name)}${a.fit ? `<span class="fit">${esc(a.fit)}</span>` : ""}</h3>
      <div class="meta">${esc(a.city)} · ${esc(a.meeting_types.join(" / "))}</div>
      <div class="tags">${a.languages.map((l) => `<span class="tag">${esc(l)}</span>`).join("")}${a.focus.map((f) => `<span class="tag">${esc(f)}</span>`).join("")}</div>
      <p class="meta">${esc(a.bio)}</p>
      <a href="${a.brokercheck_url}" target="_blank" rel="noopener">${t("verify")} ↗</a>
      <button class="secondary choose" type="button">${t("choose")}</button>`;
    card.querySelector(".choose").onclick = () => send(T[state.lang].chooseMsg(a.name));
    box.appendChild(card);
  });
}

function renderBooking(b, briefing) {
  $("#booking").innerHTML = `
    <div class="booking-card" role="status">
      <h3>✓ ${t("booked")}</h3>
      <div>${esc(b.prospect_name)} ${t("with")} <strong>${esc(b.advisor_name)}</strong></div>
      <div class="meta">${t("when")}: ${esc(b.time_slot)}</div>
    </div>`;
}

// ---------- dictation ----------
function stopDictation() {
  if (state.dictation) { state.dictation.stop(); state.dictation = null; }
  $("#mic").setAttribute("aria-pressed", "false");
  $("#mic").setAttribute("aria-label", t("micStart"));
  $("#live-hint").textContent = "";
}
async function toggleMic() {
  if (state.dictation) { stopDictation(); return; }
  try {
    const base = $("#msg").value.trim();
    state.dictation = await startDictation(CFG, state.lang, (text) => {
      $("#msg").value = (base ? base + " " : "") + text;
    });
    $("#mic").setAttribute("aria-pressed", "true");
    $("#mic").setAttribute("aria-label", t("micStop"));
    $("#live-hint").textContent = `${t("listening")} (${state.dictation.engine})`;
  } catch (e) {
    $("#live-hint").textContent = e.message;
  }
}

// ---------- advisor view ----------
async function loadBookings() {
  const box = $("#bookings");
  box.innerHTML = `<p class="muted">${t("thinking")}</p>`;
  try {
    const { bookings } = await post("/bookings");
    if (!bookings.length) { box.innerHTML = `<p class="muted">No prospects yet. Complete a booking in the Investor view.</p>`; return; }
    box.innerHTML = "";
    bookings.forEach((b) => {
      const br = b.briefing || {};
      const el = document.createElement("article");
      el.className = "bk";
      el.innerHTML = `
        <h3>${esc(b.prospect_name || "New prospect")} → ${esc(b.advisor_name || b.advisor_id)}</h3>
        <div class="meta">First meeting: ${esc(b.time_slot || "")}</div>
        <dl>
          <dt>Goals</dt><dd>${esc(br.goals || "—")}</dd>
          <dt>Worries</dt><dd>${esc(br.worries || "—")}</dd>
          <dt>Explain simply</dt><dd>${esc(br.topics_to_explain || "—")}</dd>
          <dt>How they prefer to communicate</dt><dd>${esc(br.communication_preferences || "—")}</dd>
        </dl>`;
      box.appendChild(el);
    });
  } catch (e) { box.innerHTML = `<p class="msg error">${esc(e.message)}</p>`; }
}

// ---------- dashboard ----------
const STAGES = [["intake_started", "Intake started"], ["matched", "Matched to advisors"], ["booked", "First meeting booked"], ["briefing_sent", "Advisor briefed"]];
async function loadMetrics() {
  const box = $("#funnel");
  box.innerHTML = `<p class="muted">${t("thinking")}</p>`;
  try {
    const { funnel, day } = await post("/metrics");
    const max = Math.max(1, ...STAGES.map(([k]) => funnel[k] || 0));
    box.innerHTML = `<div class="meta">Today (${esc(day)}, UTC)</div>`;
    STAGES.forEach(([k, label], i) => {
      const v = funnel[k] || 0;
      const row = document.createElement("div");
      row.className = "frow";
      row.innerHTML = `<div>${label}</div><div class="bar" style="width:${(v / max) * 100}%" role="img" aria-label="${label}: ${v}"></div><div class="val">${v}</div>`;
      box.appendChild(row);
      if (i > 0) {
        const prev = funnel[STAGES[i - 1][0]] || 0;
        if (prev) {
          const d = document.createElement("div");
          d.className = "drop";
          d.textContent = `${Math.round((v / prev) * 100)}% carried on from the previous step`;
          box.appendChild(d);
        }
      }
    });
  } catch (e) { box.innerHTML = `<p class="msg error">${esc(e.message)}</p>`; }
}

const usd = (n) => n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n).toLocaleString()}`;
function calcRoi() {
  const adv = +$("#r-adv").value, cli = +$("#r-cli").value, aum = +$("#r-aum").value, fee = +$("#r-fee").value;
  $("#o-adv").textContent = adv.toLocaleString();
  $("#o-cli").textContent = cli;
  $("#o-aum").textContent = usd(aum);
  $("#o-fee").textContent = fee.toFixed(2) + "%";
  const clients = adv * cli, assets = clients * aum, rev = assets * (fee / 100);
  $("#k-clients").textContent = clients.toLocaleString();
  $("#k-assets").textContent = usd(assets);
  $("#k-rev").textContent = usd(rev);
}

// ---------- tabs ----------
function showView(name) {
  document.querySelectorAll("[role=tab]").forEach((b) => {
    const on = b.dataset.view === name;
    b.setAttribute("aria-selected", on);
    b.tabIndex = on ? 0 : -1;
  });
  document.querySelectorAll("[role=tabpanel]").forEach((p) => (p.hidden = p.id !== "view-" + name));
  if (name === "advisor") loadBookings();
  if (name === "dashboard") loadMetrics();
}

// ---------- init ----------
async function init() {
  try { CFG = { ...CFG, ...(await (await fetch("/config.json", { cache: "no-store" })).json()) }; } catch (_) {}
  const tabs = [...document.querySelectorAll("[role=tab]")];
  chat().addEventListener("click", (e) => {
    const button = e.target.closest("button.term");
    if (!button || !chat().contains(button)) return;
    const tip = document.getElementById(button.getAttribute("aria-describedby"));
    if (!tip) return;
    const expanded = button.getAttribute("aria-expanded") === "true";
    button.setAttribute("aria-expanded", String(!expanded));
    tip.hidden = expanded;
  });
  chat().addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const button = e.target.closest("button.term[aria-expanded='true']");
    if (!button) return;
    const tip = document.getElementById(button.getAttribute("aria-describedby"));
    button.setAttribute("aria-expanded", "false");
    if (tip) tip.hidden = true;
    button.focus();
  });
  tabs.forEach((b, i) => {
    b.onclick = () => showView(b.dataset.view);
    b.onkeydown = (e) => {
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        const n = tabs[e.key === "Home" ? 0 : tabs.length - 1];
        n.focus(); showView(n.dataset.view);
        return;
      }
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      n.focus(); showView(n.dataset.view);
    };
  });
  $("#pref-es").onchange = (e) => { state.lang = e.target.checked ? "es" : "en"; applyI18n(); };
  $("#pref-simple").onchange = (e) => (state.simple = e.target.checked);
  $("#pref-large").onchange = (e) => document.documentElement.classList.toggle("large", e.target.checked);
  $("#pref-contrast").onchange = (e) => document.documentElement.classList.toggle("contrast", e.target.checked);
  $("#pref-autoread").onchange = (e) => (state.autoread = e.target.checked);
  $("#composer").onsubmit = (e) => { e.preventDefault(); send($("#msg").value); };
  $("#msg").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send($("#msg").value); } };
  $("#mic").onclick = toggleMic;
  document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => send(c.textContent)));
  $("#refresh-bookings").onclick = loadBookings;
  $("#refresh-metrics").onclick = loadMetrics;
  ["#r-adv", "#r-cli", "#r-aum", "#r-fee"].forEach((s) => ($(s).oninput = calcRoi));
  calcRoi();
  applyI18n();
  addMsg("bot", t("greeting"));
  if (!CFG.apiUrl) addMsg("bot", "Setup note: config.json has no apiUrl yet. Run the deploy script.", { cls: "error" });
}
init();
