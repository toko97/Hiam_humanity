import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as store from "./store.js";
import {
  nextQuestion, sentenceOptions, designIdeas, buildImagePrompt,
  UserFacingError, FONTS, IMAGE_STYLES, DEFAULT_STYLE, STYLE_SAMPLE_PROMPT,
} from "./ai.js";
import { generateImage, imageProvider, imageKeyConfigured } from "./images.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);
// ברירת המחדל: נגיש רק מהמחשב הזה. כדי לפתוח ברשת המקומית: HOST=0.0.0.0
const HOST = process.env.HOST || "127.0.0.1";

await store.load();
const app = express();
app.use(express.json({ limit: "15mb" }));
app.use(express.static(path.join(here, "..", "public")));
app.use("/images", express.static(store.IMAGES_DIR, { fallthrough: false }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
const str = (v, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const transcriptOf = (v) =>
  Array.isArray(v) ? v.slice(0, 30).map((t) => ({ q: str(t?.q, 500), a: str(t?.a, 2000) })) : [];
const SAFE_FILE = /^[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$/;
const HEX = /^#[0-9a-fA-F]{6}$/;

// ---------- מצב ----------
app.get("/api/status", (req, res) => {
  res.json({
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    images: imageKeyConfigured(),
    imageProvider: imageProvider(),
    fonts: FONTS,
    defaultStyle: DEFAULT_STYLE,
    styles: Object.fromEntries(
      Object.entries(IMAGE_STYLES).map(([k, v]) => [k, { label: v.label, hint: v.hint, swatch: v.swatch }]),
    ),
  });
});

app.get("/api/state", (req, res) => res.json(store.get()));

// ---------- נושא-העל של הפרויקט ----------
app.put("/api/project", wrap(async (req, res) => {
  const theme = str(req.body?.theme, 80);
  if (!theme) throw new UserFacingError("צריך לכתוב נושא לפרויקט.");
  store.get().project.theme = theme;
  await store.save();
  res.json(store.get().project);
}));

// ---------- נושאים ----------
app.post("/api/topics", wrap(async (req, res) => {
  const name = str(req.body?.name, 40);
  if (!name) throw new UserFacingError("צריך לכתוב שם לנושא.");
  const topic = { id: store.newId(), name };
  store.get().topics.push(topic);
  await store.save();
  res.json(topic);
}));

app.delete("/api/topics/:id", wrap(async (req, res) => {
  const db = store.get();
  db.topics = db.topics.filter((t) => t.id !== req.params.id);
  await store.save();
  res.json({ ok: true });
}));

// ---------- כרטיסים ----------
function cleanCard(body, existing = {}) {
  const d = body?.design || {};
  const prev = existing.design || {};
  const image = body?.image === null ? null : body?.image ?? existing.image ?? null;
  return {
    ...existing,
    topic: str(body?.topic ?? existing.topic, 40),
    quote: str(body?.quote ?? existing.quote, 400),
    signature: str(body?.signature ?? existing.signature ?? "היאם", 60),
    transcript: body?.transcript ? transcriptOf(body.transcript) : existing.transcript || [],
    image: image && SAFE_FILE.test(image.file || "")
      ? { file: image.file, prompt: str(image.prompt, 2000), style: str(image.style, 20) }
      : null,
    design: {
      background: HEX.test(d.background) ? d.background : prev.background || "#F6F1EA",
      text: HEX.test(d.text) ? d.text : prev.text || "#2B2B2B",
      accent: HEX.test(d.accent) ? d.accent : prev.accent || "#C8694B",
      font: FONTS.includes(d.font) ? d.font : prev.font || "Heebo",
      layout: ["top", "full", "frame"].includes(d.layout) ? d.layout : prev.layout || "top",
      textSize: Math.min(1.6, Math.max(0.6, Number(d.textSize) || prev.textSize || 1)),
    },
    status: ["draft", "approved"].includes(body?.status) ? body.status : existing.status || "draft",
  };
}

app.post("/api/cards", wrap(async (req, res) => {
  const now = new Date().toISOString();
  const card = { id: store.newId(), createdAt: now, updatedAt: now, ...cleanCard(req.body) };
  const db = store.get();
  db.cards.push(card);
  db.booklet.order.push(card.id);
  await store.save();
  res.json(card);
}));

app.put("/api/cards/:id", wrap(async (req, res) => {
  const db = store.get();
  const i = db.cards.findIndex((c) => c.id === req.params.id);
  if (i < 0) throw new UserFacingError("הכרטיס לא נמצא.", 404);
  db.cards[i] = { ...cleanCard(req.body, db.cards[i]), updatedAt: new Date().toISOString() };
  await store.save();
  res.json(db.cards[i]);
}));

app.delete("/api/cards/:id", wrap(async (req, res) => {
  const db = store.get();
  db.cards = db.cards.filter((c) => c.id !== req.params.id);
  db.booklet.order = db.booklet.order.filter((id) => id !== req.params.id);
  await store.save();
  res.json({ ok: true });
}));

// ---------- חוברת ----------
app.put("/api/booklet", wrap(async (req, res) => {
  const db = store.get();
  const ids = new Set(db.cards.map((c) => c.id));
  const b = req.body || {};
  if (Array.isArray(b.order)) {
    const order = b.order.filter((id) => ids.has(id));
    for (const id of ids) if (!order.includes(id)) order.push(id);
    db.booklet.order = order;
  }
  if (b.title !== undefined) db.booklet.title = str(b.title, 80);
  if (b.subtitle !== undefined) db.booklet.subtitle = str(b.subtitle, 120);
  if (b.coverImage !== undefined) {
    db.booklet.coverImage = SAFE_FILE.test(b.coverImage || "") ? b.coverImage : null;
  }
  if (b.coverDesign !== undefined) {
    const d = b.coverDesign || {};
    db.booklet.coverDesign = {
      background: HEX.test(d.background) ? d.background : "#2F3E46",
      text: HEX.test(d.text) ? d.text : "#FFFFFF",
      font: FONTS.includes(d.font) ? d.font : "Secular One",
    };
  }
  await store.save();
  res.json(db.booklet);
}));

// ---------- Claude ----------
app.post("/api/ai/question", wrap(async (req, res) => {
  const topic = str(req.body?.topic, 40);
  if (!topic) throw new UserFacingError("קודם בוחרים נושא.");
  res.json(await nextQuestion({ theme: store.get().project.theme, topic, transcript: transcriptOf(req.body?.transcript) }));
}));

app.post("/api/ai/sentences", wrap(async (req, res) => {
  const transcript = transcriptOf(req.body?.transcript).filter((t) => t.a);
  if (!transcript.length) throw new UserFacingError("עוד אין תשובות. כדאי לענות לפחות על שאלה אחת.");
  res.json(await sentenceOptions({ theme: store.get().project.theme, topic: str(req.body?.topic, 40), transcript }));
}));

app.post("/api/ai/design", wrap(async (req, res) => {
  const quote = str(req.body?.quote, 400);
  if (!quote) throw new UserFacingError("קודם כותבים את המשפט.");
  res.json(await designIdeas({ theme: store.get().project.theme, topic: str(req.body?.topic, 40), quote, style: str(req.body?.style, 20) }));
}));

// ---------- תמונות ----------
app.post("/api/images/generate", wrap(async (req, res) => {
  const promptEn = str(req.body?.prompt, 2000);
  if (!promptEn) throw new UserFacingError("חסר תיאור לתמונה.");
  const style = str(req.body?.style, 20);
  const prompt = buildImagePrompt(promptEn, style);
  const file = await generateImage(prompt);
  res.json({ file, prompt: promptEn, style });
}));

// גלריית סגנונות: תמונת דוגמה אחת לכל סגנון, כדי שהיאם תבחר סגנון לפי מה שהיא רואה.
app.post("/api/style-samples/:style", wrap(async (req, res) => {
  const style = req.params.style;
  if (!IMAGE_STYLES[style]) throw new UserFacingError("סגנון לא מוכר.", 404);
  const file = await generateImage(buildImagePrompt(STYLE_SAMPLE_PROMPT, style));
  const db = store.get();
  db.styleSamples = { ...(db.styleSamples || {}), [style]: file };
  await store.save();
  res.json({ style, file });
}));

// העלאת תמונה מהמחשב (למשל תמונה שהיאם בחרה בקנבה)
app.post("/api/images/upload", wrap(async (req, res) => {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(str(req.body?.dataUrl, 15_000_000));
  if (!m) throw new UserFacingError("אפשר להעלות רק תמונות PNG, JPG או WEBP.");
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const file = `${store.newId()}.${ext}`;
  await fs.writeFile(path.join(store.IMAGES_DIR, file), Buffer.from(m[2], "base64"));
  res.json({ file, prompt: "", style: "upload" });
}));

// ---------- שגיאות ----------
app.use((err, req, res, next) => {
  if (err instanceof UserFacingError) return res.status(err.status).json({ error: err.message });
  if (err?.status === 404 && req.path.startsWith("/images/")) return res.status(404).end();
  console.error(err);
  res.status(500).json({ error: "משהו השתבש. ננסה שוב." });
});

app.listen(PORT, HOST, () => {
  console.log(`\n  סטודיו הכרטיסים פועל: http://${HOST === "0.0.0.0" ? "localhost" : HOST}:${PORT}\n`);
  if (!process.env.ANTHROPIC_API_KEY) console.log("  ⚠ חסר ANTHROPIC_API_KEY: השאלות המכווינות לא יעבדו.");
  if (!imageKeyConfigured()) console.log(`  ⚠ חסר מפתח תמונות עבור ${imageProvider()}: יצירת תמונות לא תעבוד.`);
});
