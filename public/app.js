// סטודיו הכרטיסים – צד הדפדפן. אין כאן מפתחות: כל הקריאות לבינה מלאכותית עוברות דרך השרת המקומי.

// ---------- כלים ----------
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k in el && typeof v !== "string") el[k] = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "משהו השתבש.");
  return data;
}

let toastTimer;
function toast(msg, isError = false) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = "show" + (isError ? " error" : "");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = ""), isError ? 6000 : 2500);
}

async function busy(btn, fn) {
  if (btn.disabled) return;
  btn.disabled = true;
  btn.classList.add("busy");
  try {
    return await fn();
  } catch (err) {
    toast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.classList.remove("busy");
  }
}

const imgUrl = (file) => `/images/${encodeURIComponent(file)}`;
const GOAL = 20;

// ---------- מצב ----------
const state = {
  status: null,
  db: null,
  view: "new",
  approvedOnly: false,
  wiz: null,
};

const PRESET_PALETTES = [
  { name: "חול וים", background: "#F6F1EA", text: "#24343B", accent: "#C8694B" },
  { name: "לילה", background: "#1F2A44", text: "#F7F3E9", accent: "#F2C14E" },
  { name: "מרווה", background: "#E7EFE6", text: "#2D3B2D", accent: "#6B8F71" },
  { name: "שקיעה", background: "#FCE8DA", text: "#4A2C2A", accent: "#E07A5F" },
  { name: "לבנדר", background: "#EEE8F6", text: "#33264D", accent: "#8E6CB8" },
  { name: "פשוט", background: "#FFFFFF", text: "#111111", accent: "#2F6F6A" },
];

const fallbackQuestions = (t) => [
  `מה המילה "${t}" מעוררת בך?`,
  `ספרי על רגע אחד שבו הרגשת ${t}.`,
  `מי האדם שעולה לך בראש כשאת חושבת על ${t}?`,
  `אם ${t} היה צבע, איזה צבע הוא היה? למה?`,
  `מה היית רוצה שאנשים אחרים יבינו על ${t}?`,
  `מה למדת על ${t} מהחיים שלך?`,
  `איך ${t} נראה היום, בעולם של טלפונים ומהירות?`,
];

function newCard() {
  return {
    id: null, topic: "", quote: "", signature: "היאם", transcript: [], image: null, status: "draft",
    design: { background: "#F6F1EA", text: "#24343B", accent: "#C8694B", font: "Heebo", layout: "top", textSize: 1 },
  };
}

function newWizard(card = newCard(), step = 1) {
  return {
    step, card,
    current: null, answer: "", fallbackIndex: 0,
    sentenceOptions: null,
    style: card.image?.style && state.status.styles[card.image.style] ? card.image.style : state.status.defaultStyle,
    ideas: null, customPrompt: "",
    generated: card.image ? [card.image] : [],
    dirty: false,
  };
}

// ---------- כרטיס ----------
function cardEl(card) {
  const d = card.design;
  const el = h("div", {
    class: `card layout-${d.layout}`,
    style: `background:${d.background};color:${d.text};font-family:'${d.font}',sans-serif;--ts:${d.textSize}`,
  });
  el.append(h("div", { class: "img", style: card.image ? `background-image:url("${imgUrl(card.image.file)}")` : "" }));
  const wrapStyle = d.layout === "full" ? `background:${d.background}E6` : "";
  el.append(
    h("div", { class: "text-wrap", style: wrapStyle },
      card.topic && h("div", { class: "topic-word", style: `color:${d.accent}` }, card.topic),
      h("div", { class: "quote" }, card.quote || "כאן יופיע המשפט שלך"),
      card.signature && h("div", { class: "sig", style: `color:${d.accent}` }, card.signature),
    ),
  );
  return el;
}

function coverEl(b) {
  const d = b.coverDesign || { background: "#2F3E46", text: "#FFFFFF", font: "Secular One" };
  return h("div", { class: "card cover", style: `background:${d.background};color:${d.text};font-family:'${d.font}',sans-serif` },
    b.coverImage && h("div", { class: "img", style: `background-image:url("${imgUrl(b.coverImage)}")` }),
    h("div", { class: "cover-text" },
      h("div", { class: "cover-title" }, b.title || "המילים שלי"),
      b.subtitle && h("div", { class: "cover-sub" }, b.subtitle),
    ),
  );
}

// ---------- ניווט ----------
function go(view) {
  state.view = view;
  render();
  window.scrollTo(0, 0);
}

document.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));

function render() {
  document.querySelectorAll(".tab").forEach((b) => {
    if (b.dataset.view === state.view) b.setAttribute("aria-current", "page");
    else b.removeAttribute("aria-current");
  });
  const app = document.getElementById("app");
  app.replaceChildren(
    state.view === "cards" ? viewCards() : state.view === "booklet" ? viewBooklet() : viewWizard(),
  );
}

// ---------- אשף כרטיס חדש ----------
const STEPS = ["נושא", "שיחה", "משפט", "עיצוב", "אישור"];

function viewWizard() {
  state.wiz ??= newWizard();
  const w = state.wiz;
  const steps = h("div", { class: "steps" },
    STEPS.map((name, i) => h("div", { class: `step ${w.step === i + 1 ? "on" : w.step > i + 1 ? "done" : ""}` },
      h("b", {}, i + 1), name)),
  );
  const body = [stepTopic, stepInterview, stepSentence, stepDesign, stepApprove][w.step - 1]();
  return h("div", {}, steps, body);
}

async function saveCard(extra = {}) {
  const w = state.wiz;
  Object.assign(w.card, extra);
  const saved = w.card.id
    ? await api("PUT", `/api/cards/${w.card.id}`, w.card)
    : await api("POST", "/api/cards", w.card);
  w.card = saved;
  const i = state.db.cards.findIndex((c) => c.id === saved.id);
  if (i >= 0) state.db.cards[i] = saved;
  else {
    state.db.cards.push(saved);
    state.db.booklet.order.push(saved.id);
  }
  w.dirty = false;
  return saved;
}

async function toStep(n) {
  const w = state.wiz;
  if (w.card.topic && (w.dirty || !w.card.id)) {
    try { await saveCard(); } catch (err) { toast(err.message, true); }
  }
  w.step = n;
  render();
  window.scrollTo(0, 0);
}

function navRow(...extra) {
  const w = state.wiz;
  return h("div", { class: "row", style: "margin-top:24px" },
    w.step > 1 && h("button", { class: "btn ghost", onclick: () => toStep(w.step - 1) }, "→ חזרה"),
    h("div", { class: "spacer" }),
    ...extra,
  );
}

// --- שלב 1: נושא ---
function stepTopic() {
  const w = state.wiz;
  let editing = false;
  const usage = (name) => state.db.cards.filter((c) => c.topic === name).length;
  const grid = h("div", { class: "topic-grid" },
    state.db.topics.map((t) =>
      h("button", {
        class: "topic", style: w.card.topic === t.name ? "border-color:var(--brand);background:var(--soft)" : "",
        onclick: (e) => {
          if (e.target.classList.contains("del")) return;
          w.card.topic = t.name; w.current = null; w.dirty = true;
          toStep(2);
        },
      },
      usage(t.name) ? h("span", { class: "used" }, `✓ ${usage(t.name)}`) : null,
      h("span", {
        class: "del", title: "מחיקת הנושא",
        onclick: async () => {
          if (!confirm(`למחוק את הנושא "${t.name}" מהרשימה?`)) return;
          await api("DELETE", `/api/topics/${t.id}`);
          state.db.topics = state.db.topics.filter((x) => x.id !== t.id);
          render();
        },
      }, "×"),
      t.name)),
  );
  const input = h("input", { type: "text", placeholder: "נושא חדש…", style: "max-width:260px" });
  const add = async () => {
    const name = input.value.trim();
    if (!name) return;
    const topic = await api("POST", "/api/topics", { name }).catch((e) => toast(e.message, true));
    if (topic) { state.db.topics.push(topic); render(); }
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && add());
  const theme = state.db.project?.theme || "";
  const editTheme = async () => {
    const v = prompt("מה נושא-העל של הפרויקט?", theme);
    if (!v?.trim() || v.trim() === theme) return;
    try {
      state.db.project = await api("PUT", "/api/project", { theme: v.trim() });
      render();
    } catch (err) { toast(err.message, true); }
  };
  return h("div", { class: "panel stack" },
    h("div", { class: "theme-bar" },
      h("span", { class: "muted small" }, "נושא הפרויקט"),
      h("strong", {}, theme),
      h("button", { class: "btn ghost small", onclick: editTheme }, "שינוי"),
    ),
    h("h2", {}, "על מה נכתוב היום?"),
    h("p", { class: "muted" }, "היאם בוחרת נושא אחד. ✓ מסמן נושאים שכבר יש עליהם כרטיס."),
    grid,
    h("div", { class: "row" },
      input, h("button", { class: "btn", onclick: add }, "הוספת נושא"),
      h("div", { class: "spacer" }),
      h("button", { class: "btn ghost small", onclick: () => { editing = !editing; grid.classList.toggle("editing", editing); } }, "עריכת הרשימה"),
    ),
  );
}

// --- שלב 2: שיחה ---
function stepInterview() {
  const w = state.wiz;
  const t = w.card.topic;
  const useClaude = state.status.claude;

  const qBox = h("div", { class: "question" }, "…");
  const choices = h("div", { class: "chips" });
  const notes = h("div", { class: "stack" });
  const answer = h("textarea", {
    placeholder: "התשובה של היאם, במילים שלה…", value: w.answer,
    oninput: (e) => (w.answer = e.target.value),
  });

  function showQuestion() {
    const c = w.current;
    if (!c) return;
    qBox.replaceChildren(c.question, c.simpler ? h("span", { class: "simpler" }, `או בפשטות: ${c.simpler}`) : "");
    choices.replaceChildren(
      ...(c.choices || []).map((ch) => h("button", {
        class: "chip",
        onclick: () => { answer.value = (answer.value ? answer.value + " " : "") + ch; w.answer = answer.value; answer.focus(); },
      }, ch)),
    );
    notes.replaceChildren(
      c.pause_suggested ? h("div", { class: "note pause" }, "💛 אולי זה רגע טוב לעצור, לשאול את היאם איך היא מרגישה, ולהחליט יחד אם להמשיך.") : "",
      c.note_for_guide ? h("div", { class: "note" }, `למדריך: ${c.note_for_guide}`) : "",
    );
    readyBtn.classList.toggle("primary", Boolean(c.ready_to_write));
  }

  async function fetchQuestion(btn) {
    if (!useClaude) {
      const list = fallbackQuestions(t);
      w.current = { question: list[w.fallbackIndex % list.length], choices: [] };
      w.fallbackIndex++;
      showQuestion();
      return;
    }
    qBox.replaceChildren(h("span", { class: "muted" }, "חושב על שאלה…"));
    const run = async () => {
      w.current = await api("POST", "/api/ai/question", { topic: t, transcript: w.card.transcript });
      showQuestion();
    };
    if (btn) await busy(btn, run);
    else await run().catch((e) => { qBox.replaceChildren(h("span", { class: "muted" }, "לא הצלחתי להביא שאלה.")); toast(e.message, true); });
  }

  function record(skip) {
    if (!w.current) return;
    const a = skip ? "" : answer.value.trim();
    if (!skip && !a) return toast("עוד לא נכתבה תשובה. אפשר גם לדלג.");
    w.card.transcript.push({ q: w.current.question, a });
    w.answer = ""; answer.value = ""; w.dirty = true;
    renderTranscript();
    fetchQuestion(nextBtn);
  }

  const transcriptList = h("ol", { class: "transcript" });
  function renderTranscript() {
    transcriptList.replaceChildren(
      ...w.card.transcript.map((x, i) => h("li", {},
        h("div", { class: "row" },
          h("div", { style: "flex:1" }, h("div", { class: "q" }, x.q), h("div", { class: "a" }, x.a || "(דילגה)")),
          h("button", { class: "btn ghost small", title: "מחיקה", onclick: () => { w.card.transcript.splice(i, 1); w.dirty = true; renderTranscript(); } }, "×"),
        ))),
    );
    if (!w.card.transcript.length) transcriptList.replaceChildren(h("li", { class: "muted" }, "התשובות יופיעו כאן."));
  }

  const nextBtn = h("button", { class: "btn primary big", onclick: () => record(false) }, "שמירת התשובה ←");
  const skipBtn = h("button", { class: "btn", onclick: () => record(true) }, "דילוג");
  const otherBtn = h("button", { class: "btn ghost", onclick: (e) => fetchQuestion(e.currentTarget) }, "שאלה אחרת");
  const ownBtn = h("button", {
    class: "btn ghost",
    onclick: () => {
      const q = prompt("איזו שאלה לשאול?");
      if (q?.trim()) { w.current = { question: q.trim(), choices: [] }; showQuestion(); }
    },
  }, "שאלה משלנו");
  const readyBtn = h("button", { class: "btn big", onclick: () => toStep(3) }, "יש לי משפט ←");

  setTimeout(() => {
    renderTranscript();
    if (w.current) showQuestion(); else fetchQuestion();
  });

  return h("div", { class: "stack" },
    h("div", { class: "panel stack" },
      h("div", { class: "row" }, h("h2", {}, `נושא: ${t}`), h("div", { class: "spacer" }),
        !useClaude && h("span", { class: "badge" }, "שאלות קבועות (אין מפתח ל-Claude)")),
      qBox, notes, choices,
      h("div", { class: "row", style: "align-items:flex-start" }, h("div", { style: "flex:1" }, answer), micButton(answer, (v) => (w.answer = v))),
      h("div", { class: "row" }, nextBtn, skipBtn, otherBtn, ownBtn),
    ),
    h("div", { class: "panel" }, h("h3", {}, "מה היאם אמרה עד עכשיו"), transcriptList),
    navRow(readyBtn),
  );
}

function micButton(target, onValue) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  let rec = null;
  const btn = h("button", { class: "btn mic", title: "הכתבה בקול", onclick: () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = "he-IL";
    rec.interimResults = false;
    rec.onresult = (e) => {
      const text = Array.from(e.results).map((r) => r[0].transcript).join(" ");
      target.value = (target.value ? target.value + " " : "") + text;
      onValue(target.value);
    };
    rec.onerror = () => toast("ההכתבה לא עבדה. אפשר להקליד.", true);
    rec.onend = () => { rec = null; btn.classList.remove("listening"); btn.textContent = "🎤 הכתבה"; };
    rec.start();
    btn.classList.add("listening");
    btn.textContent = "⏹ עצירה";
  } }, "🎤 הכתבה");
  return btn;
}

// --- שלב 3: משפט ---
function stepSentence() {
  const w = state.wiz;
  const quote = h("textarea", {
    class: "quote-input", value: w.card.quote, placeholder: "המשפט של היאם…",
    oninput: (e) => { w.card.quote = e.target.value; w.dirty = true; },
  });
  const sig = h("input", {
    type: "text", value: w.card.signature, style: "max-width:260px",
    oninput: (e) => { w.card.signature = e.target.value; w.dirty = true; },
  });
  const optionsBox = h("div", { class: "options" });
  const hasAnswers = w.card.transcript.some((x) => x.a);

  function showOptions() {
    if (!w.sentenceOptions) return;
    optionsBox.replaceChildren(
      ...w.sentenceOptions.map((o) => h("button", {
        class: `option ${w.card.quote === o.text ? "on" : ""}`,
        onclick: () => { w.card.quote = o.text; quote.value = o.text; w.dirty = true; showOptions(); },
      }, o.text, o.note && h("small", {}, o.note))),
    );
  }
  const suggestBtn = h("button", {
    class: "btn",
    onclick: (e) => busy(e.currentTarget, async () => {
      const r = await api("POST", "/api/ai/sentences", { topic: w.card.topic, transcript: w.card.transcript });
      w.sentenceOptions = r.options;
      showOptions();
    }),
  }, w.sentenceOptions ? "הצעות נוספות" : "הצעות ניסוח מהמילים שלה");

  setTimeout(() => {
    showOptions();
    if (!w.sentenceOptions && hasAnswers && state.status.claude) suggestBtn.click();
  });

  return h("div", { class: "stack" },
    h("div", { class: "panel stack" },
      h("h2", {}, "המשפט על הכרטיס"),
      h("p", { class: "muted" }, "משפט אחד או שניים. היאם בוחרת הצעה או אומרת משהו אחר, ואפשר לשנות כל מילה."),
      state.status.claude && hasAnswers && h("div", { class: "row" }, suggestBtn),
      optionsBox,
      h("label", { class: "field" }, h("span", {}, "הנוסח הסופי"), quote),
      h("div", { class: "row" }, micButton(quote, (v) => { w.card.quote = v; w.dirty = true; })),
      h("label", { class: "field" }, h("span", {}, "חתימה"), sig),
    ),
    w.card.transcript.length > 0 && h("details", { class: "panel" },
      h("summary", {}, "מה היאם אמרה בשיחה"),
      h("ol", { class: "transcript" }, w.card.transcript.filter((x) => x.a).map((x) => h("li", {}, h("div", { class: "q" }, x.q), h("div", { class: "a" }, x.a)))),
    ),
    navRow(h("button", {
      class: "btn primary big",
      onclick: () => (w.card.quote.trim() ? toStep(4) : toast("קודם כותבים משפט.")),
    }, "לעיצוב ←")),
  );
}

// --- שלב 4: עיצוב ---
function stepDesign() {
  const w = state.wiz;
  const d = w.card.design;
  const S = state.status;
  const preview = h("div", { class: "preview" });
  const refresh = () => { w.dirty = true; preview.replaceChildren(cardEl(w.card), h("p", { class: "muted small", style: "text-align:center" }, "כך ייראה הכרטיס")); };
  refresh(); w.dirty = false;

  // סגנון
  const styleGrid = h("div", { class: "style-grid" });
  const samples = () => state.db.styleSamples || {};
  function renderStyles() {
    styleGrid.replaceChildren(
      ...Object.entries(S.styles).map(([key, s]) => h("button", {
        class: `style-tile ${w.style === key ? "on" : ""}`,
        onclick: () => { w.style = key; w.ideas = null; renderStyles(); renderIdeas(); },
      },
      h("div", { class: "style-img", style: samples()[key] ? `background-image:url("${imgUrl(samples()[key])}")` : `background:${s.swatch}` }),
      h("b", {}, s.label), h("span", {}, s.hint))),
    );
  }
  const missing = () => Object.keys(S.styles).filter((k) => !samples()[k]);
  const samplesBtn = h("button", {
    class: "btn small",
    onclick: (e) => busy(e.currentTarget, async () => {
      const todo = missing();
      for (let i = 0; i < todo.length; i++) {
        toast(`יוצר דוגמה ${i + 1} מתוך ${todo.length}…`);
        const r = await api("POST", `/api/style-samples/${todo[i]}`);
        state.db.styleSamples = { ...samples(), [r.style]: r.file };
        renderStyles();
      }
      toast("דוגמאות הסגנון מוכנות");
      samplesBtn.hidden = true;
    }),
  }, "יצירת תמונת דוגמה לכל סגנון");
  samplesBtn.hidden = !S.images || missing().length === 0;

  // רעיונות ותמונות
  const ideasBox = h("div", { class: "idea-grid" });
  const thumbs = h("div", { class: "thumbs" });
  function renderThumbs() {
    thumbs.replaceChildren(
      ...w.generated.map((im) => h("button", {
        class: `thumb ${w.card.image?.file === im.file ? "on" : ""}`,
        onclick: () => { w.card.image = im; renderThumbs(); refresh(); },
      }, h("img", { src: imgUrl(im.file), alt: "" }))),
      w.card.image && h("button", { class: "btn ghost small", onclick: () => { w.card.image = null; renderThumbs(); refresh(); } }, "בלי תמונה"),
    );
    if (!w.generated.length) thumbs.replaceChildren(h("span", { class: "muted small" }, "התמונות שייווצרו יופיעו כאן, והיאם תבחר אחת."));
  }
  async function generate(promptText, btn) {
    await busy(btn, async () => {
      const im = await api("POST", "/api/images/generate", { prompt: promptText, style: w.style });
      w.generated.unshift(im);
      w.card.image = im;
      renderThumbs(); refresh();
    });
  }
  function renderIdeas() {
    if (!w.ideas) return ideasBox.replaceChildren();
    ideasBox.replaceChildren(
      ...w.ideas.images.map((idea) => h("div", { class: "idea" },
        h("h3", {}, idea.title), h("p", {}, idea.description),
        h("button", { class: "btn small", disabled: !S.images, onclick: (e) => generate(idea.prompt_en, e.currentTarget) }, "יצירת התמונה"),
      )),
    );
    renderPalettes();
    renderFonts();
  }
  const ideasBtn = h("button", {
    class: "btn primary",
    onclick: (e) => busy(e.currentTarget, async () => {
      w.ideas = await api("POST", "/api/ai/design", { topic: w.card.topic, quote: w.card.quote, style: w.style });
      renderIdeas();
    }),
  }, "רעיונות לתמונה");
  const custom = h("textarea", {
    style: "min-height:70px", placeholder: "או לתאר במילים שלכם מה יהיה בתמונה…", value: w.customPrompt,
    oninput: (e) => (w.customPrompt = e.target.value),
  });
  const customBtn = h("button", {
    class: "btn", disabled: !S.images,
    onclick: (e) => (custom.value.trim() ? generate(custom.value.trim(), e.currentTarget) : toast("צריך לכתוב תיאור.")),
  }, "יצירה מהתיאור");
  const upload = h("input", {
    type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true,
    onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      const dataUrl = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(f); });
      try {
        const im = await api("POST", "/api/images/upload", { dataUrl });
        w.generated.unshift(im); w.card.image = im; renderThumbs(); refresh();
      } catch (err) { toast(err.message, true); }
      e.target.value = "";
    },
  });

  // צבעים
  const palettes = h("div", { class: "palettes" });
  const pickers = h("div", { class: "color-row" });
  function renderPalettes() {
    const list = [...(w.ideas?.palettes || []), ...PRESET_PALETTES];
    palettes.replaceChildren(
      ...list.map((p) => h("button", {
        class: `palette ${d.background === p.background && d.text === p.text ? "on" : ""}`,
        onclick: () => { Object.assign(d, { background: p.background, text: p.text, accent: p.accent }); renderPalettes(); refresh(); },
      }, h("span", { style: `background:${p.background}` }), h("span", { style: `background:${p.text}` }), h("span", { style: `background:${p.accent}` }), h("em", {}, p.name))),
    );
    pickers.replaceChildren(
      ...[["background", "רקע"], ["text", "טקסט"], ["accent", "הדגשה"]].map(([k, label]) =>
        h("label", {}, h("input", { type: "color", value: d[k], oninput: (e) => { d[k] = e.target.value.toUpperCase(); refresh(); } }), label)),
    );
  }

  // גופן
  const fonts = h("div", { class: "fonts" });
  function renderFonts() {
    const suggested = new Set(w.ideas?.fonts || []);
    const order = [...suggested, ...S.fonts.filter((f) => !suggested.has(f))];
    fonts.replaceChildren(
      ...order.map((f) => h("button", {
        class: `font-btn ${d.font === f ? "on" : ""}`, style: `font-family:'${f}'`, title: f,
        onclick: () => { d.font = f; renderFonts(); refresh(); },
      }, w.card.topic || "אני", suggested.has(f) ? " ★" : "")),
    );
  }
  const size = h("input", {
    type: "range", min: 0.6, max: 1.6, step: 0.05, value: d.textSize,
    oninput: (e) => { d.textSize = Number(e.target.value); refresh(); },
  });

  // פריסה
  const LAYOUTS = { top: "תמונה למעלה", full: "תמונה מלאה", frame: "מסגרת" };
  const layouts = h("div", { class: "chips" });
  function renderLayouts() {
    layouts.replaceChildren(...Object.entries(LAYOUTS).map(([k, label]) => h("button", {
      class: `chip ${d.layout === k ? "on" : ""}`, onclick: () => { d.layout = k; renderLayouts(); refresh(); },
    }, label)));
  }

  renderStyles(); renderThumbs(); renderIdeas(); renderPalettes(); renderFonts(); renderLayouts();

  return h("div", { class: "stack" },
    h("div", { class: "design-layout" },
      h("div", { class: "panel stack" },
        h("h2", {}, "העיצוב של היאם"),
        !S.images && h("div", { class: "note" }, "אין מפתח ליצירת תמונות, אבל אפשר להעלות תמונה מהמחשב (למשל מקנבה)."),
        h("details", { class: "section", open: true },
          h("summary", {}, "1. סגנון התמונה"),
          h("div", { class: "stack" }, styleGrid, samplesBtn)),
        h("details", { class: "section", open: true },
          h("summary", {}, "2. התמונה"),
          h("div", { class: "stack" },
            h("div", { class: "row" }, S.claude && ideasBtn,
              h("button", { class: "btn ghost", onclick: () => upload.click() }, "העלאת תמונה מהמחשב"), upload),
            ideasBox,
            h("div", { class: "row", style: "align-items:flex-start" }, h("div", { style: "flex:1" }, custom), customBtn),
            thumbs)),
        h("details", { class: "section", open: true },
          h("summary", {}, "3. צבעים"),
          h("div", { class: "stack" }, palettes, pickers)),
        h("details", { class: "section", open: true },
          h("summary", {}, "4. גופן"),
          h("div", { class: "stack" }, fonts, h("label", { class: "row small" }, "גודל הטקסט", size))),
        h("details", { class: "section", open: true },
          h("summary", {}, "5. פריסה"),
          layouts),
      ),
      preview,
    ),
    navRow(
      h("button", { class: "btn", onclick: (e) => busy(e.currentTarget, async () => { await saveCard(); toast("נשמר"); }) }, "שמירה"),
      h("button", { class: "btn primary big", onclick: () => toStep(5) }, "לאישור ←"),
    ),
  );
}

// --- שלב 5: אישור ---
function stepApprove() {
  const w = state.wiz;
  return h("div", { class: "stack" },
    h("div", { class: "panel stack", style: "text-align:center" },
      h("h2", {}, "זה הכרטיס?"),
      h("div", { style: "max-width:420px;margin:0 auto" }, cardEl(w.card)),
      h("div", { class: "row", style: "justify-content:center" },
        h("button", { class: "btn ghost", onclick: () => toStep(3) }, "לשנות את המשפט"),
        h("button", { class: "btn ghost", onclick: () => toStep(4) }, "לשנות את העיצוב"),
      ),
    ),
    navRow(
      h("button", { class: "btn", onclick: (e) => busy(e.currentTarget, async () => { await saveCard({ status: "draft" }); toast("נשמר כטיוטה"); go("cards"); state.wiz = null; }) }, "שמירה כטיוטה"),
      h("button", {
        class: "btn primary big",
        onclick: (e) => busy(e.currentTarget, async () => {
          await saveCard({ status: "approved" });
          toast("✓ הכרטיס אושר ונוסף לחוברת");
          state.wiz = null;
          go("cards");
        }),
      }, "✓ היאם מאשרת"),
    ),
  );
}

// ---------- הכרטיסים ----------
function viewCards() {
  const cards = [...state.db.cards].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const approved = cards.filter((c) => c.status === "approved").length;
  return h("div", { class: "stack" },
    h("div", { class: "panel stack" },
      h("div", { class: "row" },
        h("h2", {}, "הכרטיסים של היאם"), h("div", { class: "spacer" }),
        h("button", { class: "btn primary", onclick: () => { state.wiz = newWizard(); go("new"); } }, "+ כרטיס חדש")),
      h("div", {}, `${approved} כרטיסים מאושרים מתוך יעד של ${GOAL}`),
      h("div", { class: "progress" }, h("div", { style: `width:${Math.min(100, (approved / GOAL) * 100)}%` })),
    ),
    cards.length === 0
      ? h("p", { class: "muted" }, "עוד אין כרטיסים. מתחילים ב\"כרטיס חדש\".")
      : h("div", { class: "gallery" }, cards.map((c) => h("div", { class: "gallery-item" },
        cardEl(c),
        h("div", { class: "meta" },
          h("span", { class: `badge ${c.status === "approved" ? "ok" : ""}` }, c.status === "approved" ? "מאושר" : "טיוטה"),
          h("span", { class: "muted small" }, new Date(c.createdAt).toLocaleDateString("he-IL")),
          h("div", { class: "spacer" }),
          h("button", { class: "btn ghost small", onclick: () => { state.wiz = newWizard(structuredClone(c), 4); go("new"); } }, "עריכה"),
          c.image && h("a", { class: "btn ghost small", href: imgUrl(c.image.file), download: `${c.topic}.png` }, "הורדת התמונה"),
          h("button", {
            class: "btn ghost small", style: "color:var(--danger)",
            onclick: async () => {
              if (!confirm("למחוק את הכרטיס? אי אפשר לבטל.")) return;
              await api("DELETE", `/api/cards/${c.id}`);
              state.db.cards = state.db.cards.filter((x) => x.id !== c.id);
              state.db.booklet.order = state.db.booklet.order.filter((id) => id !== c.id);
              render();
            },
          }, "מחיקה"),
        )))),
  );
}

// ---------- החוברת ----------
function bookletCards() {
  const byId = new Map(state.db.cards.map((c) => [c.id, c]));
  return state.db.booklet.order.map((id) => byId.get(id)).filter((c) => c && (!state.approvedOnly || c.status === "approved"));
}

function viewBooklet() {
  const b = state.db.booklet;
  b.coverDesign ??= { background: "#2F3E46", text: "#FFFFFF", font: "Secular One" };
  const coverBox = h("div", { style: "max-width:300px" });
  const refreshCover = () => coverBox.replaceChildren(coverEl(b));
  let saveTimer;
  const saveBooklet = (patch) => {
    Object.assign(b, patch);
    refreshCover();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => api("PUT", "/api/booklet", patch).catch((e) => toast(e.message, true)), 400);
  };
  refreshCover();

  const list = h("ol", { class: "order-list" });
  function renderList() {
    const cards = bookletCards();
    list.replaceChildren(...cards.map((c, i) => h("li", {},
      h("span", { class: "num" }, i + 1),
      h("div", { class: "mini" }, cardEl(c)),
      h("div", {}, h("b", {}, c.topic), h("div", { class: "small muted" }, c.quote.slice(0, 60) + (c.quote.length > 60 ? "…" : ""))),
      h("div", { class: "row", style: "gap:6px" },
        h("button", { class: "arrow", title: "למעלה", disabled: i === 0, onclick: () => move(c.id, -1) }, "▲"),
        h("button", { class: "arrow", title: "למטה", disabled: i === cards.length - 1, onclick: () => move(c.id, 1) }, "▼")),
    )));
    if (!cards.length) list.replaceChildren(h("li", { class: "muted" }, "אין עדיין כרטיסים בחוברת."));
  }
  function move(id, dir) {
    const visible = bookletCards().map((c) => c.id);
    const i = visible.indexOf(id);
    const other = visible[i + dir];
    if (!other) return;
    const order = [...b.order];
    const a = order.indexOf(id), z = order.indexOf(other);
    [order[a], order[z]] = [order[z], order[a]];
    b.order = order;
    renderList();
    api("PUT", "/api/booklet", { order }).catch((e) => toast(e.message, true));
  }
  renderList();

  const cd = b.coverDesign;
  const imgs = state.db.cards.filter((c) => c.image).map((c) => c.image.file);
  return h("div", { class: "booklet-layout" },
    h("div", { class: "panel stack" },
      h("h2", {}, "שער החוברת"),
      coverBox,
      h("label", { class: "field" }, h("span", {}, "כותרת"), h("input", { type: "text", value: b.title, oninput: (e) => saveBooklet({ title: e.target.value }) })),
      h("label", { class: "field" }, h("span", {}, "כותרת משנה"), h("input", { type: "text", value: b.subtitle, oninput: (e) => saveBooklet({ subtitle: e.target.value }) })),
      h("div", { class: "color-row" },
        h("label", {}, h("input", { type: "color", value: cd.background, oninput: (e) => saveBooklet({ coverDesign: { ...cd, background: e.target.value.toUpperCase() } }) }), "רקע"),
        h("label", {}, h("input", { type: "color", value: cd.text, oninput: (e) => saveBooklet({ coverDesign: { ...b.coverDesign, text: e.target.value.toUpperCase() } }) }), "טקסט"),
      ),
      h("label", { class: "field" }, h("span", {}, "גופן"),
        h("select", { onchange: (e) => saveBooklet({ coverDesign: { ...b.coverDesign, font: e.target.value } }) },
          state.status.fonts.map((f) => h("option", { value: f, selected: f === cd.font }, f)))),
      imgs.length > 0 && h("div", {},
        h("div", { style: "font-weight:600;margin-bottom:6px" }, "תמונה לשער"),
        h("div", { class: "thumbs" },
          h("button", { class: `thumb ${!b.coverImage ? "on" : ""}`, onclick: () => { saveBooklet({ coverImage: null }); render(); } }, "בלי"),
          imgs.map((f) => h("button", { class: `thumb ${b.coverImage === f ? "on" : ""}`, onclick: () => { saveBooklet({ coverImage: f }); render(); } }, h("img", { src: imgUrl(f), alt: "" }))))),
    ),
    h("div", { class: "panel stack" },
      h("div", { class: "row" },
        h("h2", {}, "סדר הכרטיסים"), h("div", { class: "spacer" }),
        h("label", { class: "row small" }, h("input", { type: "checkbox", checked: state.approvedOnly, onchange: (e) => { state.approvedOnly = e.target.checked; renderList(); } }), "רק כרטיסים מאושרים"),
        h("button", { class: "btn primary", onclick: (e) => busy(e.currentTarget, printBooklet) }, "הפקת PDF"),
      ),
      h("p", { class: "muted small" }, "היאם קובעת את הסדר בעזרת החצים. בחלון ההדפסה בוחרים \"שמירה כ-PDF\"."),
      list,
    ),
  );
}

async function printBooklet() {
  const b = state.db.booklet;
  const cards = bookletCards();
  if (!cards.length) throw new Error("אין כרטיסים להדפסה.");
  const area = document.getElementById("print-area");
  area.replaceChildren(
    h("div", { class: "print-page" }, coverEl(b)),
    ...cards.map((c) => h("div", { class: "print-page" }, cardEl(c))),
  );
  const files = [b.coverImage, ...cards.map((c) => c.image?.file)].filter(Boolean);
  await Promise.all(files.map((f) => new Promise((r) => { const i = new Image(); i.onload = i.onerror = r; i.src = imgUrl(f); })));
  await document.fonts.ready;
  window.print();
}

// ---------- התחלה ----------
(async function init() {
  try {
    [state.status, state.db] = await Promise.all([api("GET", "/api/status"), api("GET", "/api/state")]);
  } catch {
    document.getElementById("app").textContent = "השרת לא זמין. האם הפעלתם את npm start?";
    return;
  }
  const missing = [];
  if (!state.status.claude) missing.push("אין מפתח ל-Claude: השאלות יהיו קבועות ובלי הצעות ניסוח.");
  if (!state.status.images) missing.push("אין מפתח ליצירת תמונות: אפשר להעלות תמונות מהמחשב.");
  const banner = document.getElementById("banner");
  if (missing.length) { banner.textContent = missing.join(" "); banner.hidden = false; }
  render();
})();
