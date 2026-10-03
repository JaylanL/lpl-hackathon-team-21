import "./style.css";
import { startDictation } from "./dictation.js";

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
    languageLabel: "Language", textSize: "Text size", settings: "Settings", prefContrast: "High contrast", prefRead: "Read replies aloud",
    howEyebrow: "Advisor Match", howTitle: "How it works",
    howStep1Title: "1. Tell us your goals", howStep1Body: "Chat or speak in your own words: what you're saving for, what worries you, and how you like to meet. There are no wrong answers.",
    howStep2Title: "2. Meet 3 matches", howStep2Body: "See three advisors who fit your goals, language and schedule, with a plain-language reason for each one. Verify any of them on FINRA BrokerCheck.",
    howStep3Title: "3. Walk in ready", howStep3Body: "Book a time and get a personal prep kit: key terms explained simply, questions to ask, and what to bring. Your advisor gets a briefing too, so you start with your goals, not paperwork.",
    howFootnote: "Free to use. We help you prepare, not invest: your advisor gives the advice.",
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
    error: "Sorry, something went wrong. Please try again.",
    tabDirectory: "All advisors", dirTitle: "All advisors", dirLead: "Browse every advisor, not just your top matches. Filter by language or meeting type, then ask to meet anyone who looks right.",
    dirLanguage: "Language", dirMeeting: "Meeting type", dirAny: "Any", dirVirtual: "Virtual", dirInPerson: "In person", dirSearch: "Search", dirSearchPh: "e.g. home buyers, Miami",
    dirCount: (n, total) => `Showing ${n} of ${total} advisors`, dirEmpty: "No advisors match these filters. Try removing one.",
    openSlots: (n) => (n > 0 ? `Accepting new clients · ${n} open slot${n === 1 ? "" : "s"}` : "Not accepting new clients right now"), askToMeet: "Ask to meet",
    progressLabel: "Getting to know you", matchScore: (n) => `${n}% match`, whyFit: "Why this match",
    langNames: { English: "English", Spanish: "Spanish", Mandarin: "Mandarin" },
    reason: {
      language: (v, t) => `Speaks ${t.langNames[v] ?? v}, your preferred language`,
      meeting: (v) => (v === "in-person" ? "Offers in-person meetings" : "Offers virtual meetings"),
      focus: (v) => `Focuses on ${v}`,
      availability: (n) => `${n} open first-meeting slot${n === 1 ? "" : "s"}`,
    },
    driversNote: "Ranked mostly by", drivers: { expertise: "fit with your goals", language: "language", meeting: "meeting type", availability: "availability" },
    feeLabel: "How they're paid", formCrs: "You'll get a Form CRS: a short summary of services, fees and conflicts of interest.",
  },
  es: {
    tagline: "Encuentre a su asesor. Llegue preparado.", tabInvestor: "Inversionista", tabAdvisor: "Asesor", tabDashboard: "Panel de negocio",
    languageLabel: "Idioma", textSize: "Tamaño del texto", settings: "Ajustes", prefContrast: "Alto contraste", prefRead: "Leer respuestas en voz alta",
    howEyebrow: "Advisor Match", howTitle: "Cómo funciona",
    howStep1Title: "1. Cuéntenos sus metas", howStep1Body: "Escriba o hable con sus propias palabras: para qué está ahorrando, qué le preocupa y cómo prefiere reunirse. No hay respuestas incorrectas.",
    howStep2Title: "2. Conozca 3 opciones", howStep2Body: "Vea tres asesores que coinciden con sus metas, idioma y horario, con una explicación sencilla de cada coincidencia. Verifique cualquiera en FINRA BrokerCheck.",
    howStep3Title: "3. Llegue preparado", howStep3Body: "Reserve una cita y reciba una guía personal: conceptos clave explicados de forma sencilla, preguntas para hacer y qué llevar. Su asesor también recibe un resumen de sus metas.",
    howFootnote: "Uso gratuito. Le ayudamos a prepararse, no a invertir: su asesor le da el consejo.",
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
    error: "Lo siento, algo salió mal. Intente de nuevo.",
    tabDirectory: "Todos los asesores", dirTitle: "Todos los asesores", dirLead: "Vea a todos los asesores, no solo sus mejores coincidencias. Filtre por idioma o tipo de reunión y pida reunirse con quien le parezca bien.",
    dirLanguage: "Idioma", dirMeeting: "Tipo de reunión", dirAny: "Cualquiera", dirVirtual: "Virtual", dirInPerson: "Presencial", dirSearch: "Buscar", dirSearchPh: "p. ej. compradores de casa, Miami",
    dirCount: (n, total) => `Mostrando ${n} de ${total} asesores`, dirEmpty: "Ningún asesor coincide con estos filtros. Quite alguno.",
    openSlots: (n) => (n > 0 ? `Acepta clientes nuevos · ${n} cita${n === 1 ? "" : "s"} disponible${n === 1 ? "" : "s"}` : "No acepta clientes nuevos por ahora"), askToMeet: "Pedir reunión",
    progressLabel: "Conociéndole", matchScore: (n) => `${n}% de coincidencia`, whyFit: "Por qué coincide",
    langNames: { English: "inglés", Spanish: "español", Mandarin: "mandarín" },
    reason: {
      language: (v, t) => `Habla ${t.langNames[v] ?? v}, su idioma preferido`,
      meeting: (v) => (v === "in-person" ? "Ofrece reuniones presenciales" : "Ofrece reuniones virtuales"),
      focus: (v) => `Se especializa en: ${v}`,
      availability: (n) => `${n} cita${n === 1 ? "" : "s"} disponible${n === 1 ? "" : "s"}`,
    },
    driversNote: "Clasificado principalmente por", drivers: { expertise: "afinidad con sus metas", language: "idioma", meeting: "tipo de reunión", availability: "disponibilidad" },
    feeLabel: "Cómo cobra", formCrs: "Recibirá un Form CRS: un resumen breve de servicios, costos y conflictos de interés.",
  },
  zh: {
    languageLabel: "语言", textSize: "文字大小", settings: "设置", prefContrast: "高对比度", prefRead: "朗读回复",
    howEyebrow: "Advisor Match", howTitle: "使用方法",
    howStep1Title: "1. 告诉我们您的目标", howStep1Body: "用自己的话输入或说出您正在为什​​么储蓄、担心什么，以及喜欢怎样见面。没有错误答案。",
    howStep2Title: "2. 认识 3 位匹配顾问", howStep2Body: "查看符合您目标、语言和时间安排的三位顾问，并了解每位顾问适合您的简单原因。您可以在 FINRA BrokerCheck 上核实他们。",
    howStep3Title: "3. 做好会面准备", howStep3Body: "预约时间并获得个人准备清单：简单解释的关键术语、可以提出的问题以及需要携带的材料。您的顾问也会收到一份目标摘要。",
    howFootnote: "免费使用。我们帮助您做好准备，而不是替您投资：您的顾问会提供建议。",
    tabDirectory: "所有顾问", dirTitle: "所有顾问", dirLead: "浏览所有顾问，而不仅仅是您的最佳匹配。按语言或会议方式筛选，然后向合适的顾问申请会面。",
    dirLanguage: "语言", dirMeeting: "会议方式", dirAny: "不限", dirVirtual: "线上", dirInPerson: "面对面", dirSearch: "搜索", dirSearchPh: "例如：首次购房、Miami",
    dirCount: (n, total) => `显示 ${n} / ${total} 位顾问`, dirEmpty: "没有符合这些条件的顾问。请尝试移除一个筛选条件。",
    openSlots: (n) => (n > 0 ? `接受新客户 · ${n} 个可预约时段` : "目前不接受新客户"), askToMeet: "申请会面",
    progressLabel: "了解您", matchScore: (n) => `匹配度 ${n}%`, whyFit: "匹配原因",
    langNames: { English: "英语", Spanish: "西班牙语", Mandarin: "普通话" },
    reason: {
      language: (v, t) => `会说${t.langNames[v] ?? v}，您偏好的语言`,
      meeting: (v) => (v === "in-person" ? "提供面对面会议" : "提供线上会议"),
      focus: (v) => `专注于：${v}`,
      availability: (n) => `${n} 个可预约时段`,
    },
    driversNote: "主要排序依据", drivers: { expertise: "与您目标的契合度", language: "语言", meeting: "会议方式", availability: "可预约时间" },
    feeLabel: "收费方式", formCrs: "您将收到 Form CRS：一份关于服务、费用和利益冲突的简短说明。",
  },
};
const LANGUAGE_NAMES = { en: "English", es: "Spanish", zh: "Mandarin" };
const state = { lang: "en", autoread: false, sessionId: null, busy: false, dictation: null, lastMatches: [] };
const t = (k) => (T[state.lang] ?? T.en)[k] ?? T.en[k];

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

// ---------- DOM helpers ----------
const $ = (s) => document.querySelector(s);
const chat = () => $("#chat");
function addMsg(role, text, opts = {}) {
  const div = document.createElement("div");
  div.className = `msg ${role}${opts.cls ? " " + opts.cls : ""}`;
  const body = document.createElement("div");
  body.className = "msg-body";
  body.innerHTML = role === "bot" && !opts.cls ? md(text) : `<p>${esc(text)}</p>`;
  if (role === "bot") {
    const avatar = document.createElement("span");
    avatar.className = "agent-avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "AM";
    div.append(avatar, body);
  } else div.append(body);
  if (role === "bot" && !opts.cls) {
    const b = document.createElement("button");
    b.className = "speak";
    b.type = "button";
    b.textContent = "🔊 " + t("readAloud");
    b.setAttribute("aria-label", t("readAloud"));
    b.onclick = () => speak(text);
    body.appendChild(b);
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
async function send(text, selectedAdvisorId) {
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
    const res = await post("/chat", { message: text, session_id: state.sessionId, lang: LANGUAGE_NAMES[state.lang], ...(selectedAdvisorId ? { selected_advisor_id: selectedAdvisorId } : {}) });
    state.sessionId = res.session_id;
    typing.remove();
    addMsg("bot", res.reply || "…");
    if (res.progress) renderProgress(res.progress);
    if (res.matches) renderMatches((state.lastMatches = res.matches));
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

// Intake progress (how many preference slots are filled), announced politely to screen readers.
function renderProgress(p) {
  const box = $("#intake-progress");
  box.hidden = false;
  $("#progress-val").textContent = `${p.percent}%`;
  box.querySelector(".progress-track").setAttribute("aria-valuenow", p.percent);
  box.querySelector(".progress-fill").style.width = `${p.percent}%`;
}

// Explainable match notes: deterministic reasons from the ranking, rendered in the user's language.
function reasonText(r) {
  const L = T[state.lang] ?? T.en;
  const fn = (L.reason ?? T.en.reason)[r.code];
  return fn ? fn(r.value, L.langNames ? L : T.en) : "";
}

function renderMatches(list) {
  const box = $("#matches");
  box.innerHTML = "";
  list.forEach((a) => {
    const card = document.createElement("article");
    card.className = "match";
    const reasons = (a.reasons || []).map(reasonText).filter(Boolean);
    const drivers = (a.drivers || []).map((d) => t("drivers")[d] ?? d).join(", ");
    const d = a.disclosure;
    card.innerHTML = `
      <h3>${esc(a.name)}${a.fit ? `<span class="fit">${esc(a.fit)}</span>` : ""}</h3>
      ${a.match_score != null ? `<div class="score">${esc(t("matchScore")(a.match_score))}</div>` : ""}
      <div class="meta">${esc(a.city)} · ${esc(a.meeting_types.join(" / "))}</div>
      <div class="tags">${a.languages.map((l) => `<span class="tag">${esc(l)}</span>`).join("")}${a.focus.map((f) => `<span class="tag">${esc(f)}</span>`).join("")}</div>
      ${reasons.length ? `<div class="why"><strong>${esc(t("whyFit"))}</strong><ul>${reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>${drivers ? `<div class="fineprint">${esc(t("driversNote"))}: ${esc(drivers)}</div>` : ""}</div>` : ""}
      <p class="meta">${esc(a.bio)}</p>
      ${d ? `<div class="disclosure"><strong>${esc(t("feeLabel"))}:</strong> ${esc(d.fee_model)} · ${esc(d.platform)}<div class="fineprint">${esc(t("formCrs"))}</div></div>` : ""}
      <a href="${a.brokercheck_url}" target="_blank" rel="noopener">${t("verify")} ↗</a>
      <button class="secondary choose" type="button">${t("choose")}</button>`;
    card.querySelector(".choose").onclick = () => send((T[state.lang] ?? T.en).chooseMsg?.(a.name) ?? T.en.chooseMsg(a.name));
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

// ---------- advisor directory ----------
let dirTimer = null;
async function loadDirectory() {
  const box = $("#directory");
  box.setAttribute("aria-busy", "true");
  try {
    const { advisors, total } = await post("/advisors", {
      language: $("#dir-lang").value, meeting_type: $("#dir-meeting").value, text: $("#dir-text").value,
    });
    state.directory = { advisors, total };
    renderDirectory();
  } catch (e) { box.innerHTML = `<p class="msg error">${esc(e.message)}</p>`; }
  finally { box.removeAttribute("aria-busy"); }
}
function renderDirectory() {
  if (!state.directory) return;
  const { advisors, total } = state.directory;
  const box = $("#directory");
  $("#dir-count").textContent = t("dirCount")(advisors.length, total);
  box.innerHTML = advisors.length ? "" : `<p class="muted">${esc(t("dirEmpty"))}</p>`;
  advisors.forEach((a) => {
    const d = a.disclosure || {};
    const card = document.createElement("article");
    card.className = "match dir-card";
    card.innerHTML = `
      <h3>${esc(a.name)}</h3>
      <div class="meta">${esc(a.city)} · ${esc(a.meeting_types.join(" / "))}</div>
      <div class="slots ${a.open_slots > 0 ? "open" : ""}">${esc(t("openSlots")(a.open_slots))}</div>
      <div class="tags">${a.languages.map((l) => `<span class="tag">${esc(l)}</span>`).join("")}${a.focus.map((f) => `<span class="tag">${esc(f)}</span>`).join("")}</div>
      <p class="meta">${esc(a.bio)}</p>
      <div class="disclosure"><strong>${esc(t("feeLabel"))}:</strong> ${esc(d.fee_model || "")} · ${esc(d.platform || "")}</div>
      <a href="${a.brokercheck_url}" target="_blank" rel="noopener">${t("verify")} ↗</a>
      <button class="secondary choose" type="button" ${a.open_slots > 0 ? "" : "disabled"}>${esc(t("askToMeet"))}</button>`;
    card.querySelector(".choose").onclick = () => {
      showView("investor");
      send((T[state.lang] ?? T.en).chooseMsg?.(a.name) ?? T.en.chooseMsg(a.name), a.advisor_id);
    };
    box.appendChild(card);
  });
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
        <div class="meta">First meeting: ${esc(b.time_slot || "")}
          ${b.crm_status ? `<span class="crm ${b.crm_status === "synced" ? "ok" : ""}">${b.crm_status === "synced" ? "✓ Synced to CRM" : "CRM sync pending"}</span>` : ""}</div>
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
    // Compliance guardrails at work: blocked PII and guardrail interventions (never shown as funnel drop-off).
    const pii = funnel.pii_blocked || 0, gr = funnel.guardrail_blocked || 0;
    const c = document.createElement("div");
    c.className = "meta compliance";
    c.textContent = `Compliance today: ${pii} message${pii === 1 ? "" : "s"} with personal identifiers blocked · ${gr} guardrail intervention${gr === 1 ? "" : "s"}`;
    box.appendChild(c);
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
  if (name === "directory") loadDirectory();
  if (name === "dashboard") loadMetrics();
}

// ---------- init ----------
async function init() {
  try { CFG = { ...CFG, ...(await (await fetch("/config.json", { cache: "no-store" })).json()) }; } catch (_) {}
  const tabs = [...document.querySelectorAll("[role=tab]")];
  tabs.forEach((b, i) => {
    b.onclick = () => showView(b.dataset.view);
    b.onkeydown = (e) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      const n = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      n.focus(); showView(n.dataset.view);
    };
  });
  document.querySelectorAll(".language-option").forEach((button) => (button.onclick = () => {
    state.lang = button.dataset.lang;
    document.querySelectorAll(".language-option").forEach((option) => {
      const active = option === button;
      option.classList.toggle("active", active);
      option.setAttribute("aria-pressed", active);
    });
    applyI18n();
    if ($("#matches .match")) renderMatches(state.lastMatches || []);
    renderDirectory();
  }));
  document.querySelectorAll(".size-option").forEach((button) => (button.onclick = () => {
    const size = Number(button.dataset.size);
    document.documentElement.style.setProperty("--base", `${size / 100 * 17}px`);
    document.querySelectorAll(".size-option").forEach((option) => {
      const active = option === button;
      option.classList.toggle("active", active);
      option.setAttribute("aria-pressed", active);
    });
  }));
  $("#pref-contrast").onchange = (e) => document.documentElement.classList.toggle("contrast", e.target.checked);
  $("#pref-autoread").onchange = (e) => (state.autoread = e.target.checked);
  $("#settings-toggle").onclick = () => {
    const open = $("#settings-panel").classList.toggle("open");
    $("#settings-toggle").setAttribute("aria-expanded", open);
  };
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      $("#settings-panel").classList.remove("open");
      $("#settings-toggle").setAttribute("aria-expanded", "false");
    }
  });
  $("#composer").onsubmit = (e) => { e.preventDefault(); send($("#msg").value); };
  $("#msg").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send($("#msg").value); } };
  $("#mic").onclick = toggleMic;
  document.querySelectorAll(".chip").forEach((c) => (c.onclick = () => send(c.textContent)));
  $("#refresh-bookings").onclick = loadBookings;
  $("#dir-filters").onsubmit = (e) => { e.preventDefault(); loadDirectory(); };
  $("#dir-lang").onchange = loadDirectory;
  $("#dir-meeting").onchange = loadDirectory;
  $("#dir-text").oninput = () => { clearTimeout(dirTimer); dirTimer = setTimeout(loadDirectory, 250); };
  $("#refresh-metrics").onclick = loadMetrics;
  ["#r-adv", "#r-cli", "#r-aum", "#r-fee"].forEach((s) => ($(s).oninput = calcRoi));
  calcRoi();
  applyI18n();
  addMsg("bot", t("greeting"));
  if (!CFG.apiUrl) addMsg("bot", "Setup note: config.json has no apiUrl yet. Run the deploy script.", { cls: "error" });
}
init();
