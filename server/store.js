// אחסון מקומי פשוט בקובץ JSON. כל התוכן נשאר על המחשב שלכם, בתיקייה data/.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
export const IMAGES_DIR = path.join(DATA_DIR, "images");
const DB_FILE = path.join(DATA_DIR, "db.json");

// נושא-העל של הפרויקט. ניתן לשינוי מתוך התוכנה (לא נעול).
export const DEFAULT_THEME = "אנושיות במאה ה-21";

// נושאים לכרטיסים, ברוח נושא-העל. אפשר להוסיף ולמחוק מתוך התוכנה.
const DEFAULT_TOPICS = [
  "פחד", "תקווה", "חברות", "משפחה", "חמלה", "כבוד", "בדידות", "שייכות",
  "קהילה", "עזרה לזולת", "שונות וקבלה", "אמון", "טכנולוגיה וקשר אנושי",
  "רשתות חברתיות", "בינה מלאכותית", "מהירות החיים", "טבע ואדם", "אמת",
  "חופש", "שוויון", "נתינה", "אומץ",
].map((name) => ({ id: randomUUID(), name }));

const EMPTY_DB = () => ({
  project: { theme: DEFAULT_THEME },
  topics: DEFAULT_TOPICS,
  cards: [],
  booklet: { title: DEFAULT_THEME, subtitle: "היאם שחאדה", coverImage: null, order: [] },
});

let db = null;
let writing = Promise.resolve();

export async function load() {
  await fs.mkdir(IMAGES_DIR, { recursive: true });
  try {
    db = JSON.parse(await fs.readFile(DB_FILE, "utf8"));
    db.project ??= { theme: DEFAULT_THEME };
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    db = EMPTY_DB();
    await save();
  }
  return db;
}

export function get() {
  return db;
}

// כתיבה אטומית ובתור, כדי ששתי שמירות לא ידרסו זו את זו.
export function save() {
  writing = writing.then(async () => {
    const tmp = DB_FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(db, null, 2), "utf8");
    await fs.rename(tmp, DB_FILE);
  });
  return writing;
}

export function newId() {
  return randomUUID();
}
