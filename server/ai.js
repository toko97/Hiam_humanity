// כל הקריאות ל-Claude. המפתח נקרא מ-ANTHROPIC_API_KEY בשרת בלבד, ולא נשלח לדפדפן.
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new UserFacingError("חסר מפתח ל-Claude. יש להוסיף ANTHROPIC_API_KEY לקובץ ‎.env ולהפעיל מחדש.");
  }
  client ??= new Anthropic();
  return client;
}

export class UserFacingError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const FONTS = [
  "Heebo", "Rubik", "Assistant", "Varela Round", "Secular One",
  "Suez One", "Frank Ruhl Libre", "David Libre", "Amatic SC", "Karantina",
];

// הסגנון הראשון הוא ברירת המחדל. hint הוא תיאור קצר להיאם, swatch משמש כתצוגה כשעוד אין דוגמה.
export const IMAGE_STYLES = {
  abstract_soft: {
    label: "מופשט רך", hint: "כתמי צבע רכים שנמזגים זה בזה",
    en: "soft abstract painting, blended color fields, gentle gradients and diffused light, no recognizable objects",
    swatch: "radial-gradient(circle at 30% 35%, #F2B880 0 22%, transparent 45%), radial-gradient(circle at 70% 65%, #9CC5C0 0 25%, transparent 50%), #F5EBDD",
  },
  abstract_geo: {
    label: "מופשט גיאומטרי", hint: "עיגולים, קשתות ומלבנים בצבעים נקיים",
    en: "abstract geometric composition, circles, arches and rectangles, mid-century modern, flat clean colors, subtle paper grain",
    swatch: "radial-gradient(circle at 65% 35%, #E07A5F 0 18%, transparent 19%), linear-gradient(180deg, transparent 55%, #3D405B 55%), #F4F1DE",
  },
  abstract_watercolor: {
    label: "מופשט בצבעי מים", hint: "כתמים שקופים של צבעי מים על נייר",
    en: "abstract watercolor washes and blooms on textured paper, translucent layers, organic edges",
    swatch: "radial-gradient(ellipse at 35% 40%, #8EC5FC88 0 30%, transparent 55%), radial-gradient(ellipse at 65% 60%, #E0C3FC99 0 30%, transparent 55%), #FBFAF7",
  },
  abstract_lines: {
    label: "קווים ונקודות", hint: "קווים דקים ונקודות, הרבה מקום לבן",
    en: "minimal abstract line art, flowing thin lines and small dots, lots of empty space, two or three colors",
    swatch: "repeating-radial-gradient(circle at 50% 120%, transparent 0 12px, #2F6F6A 12px 14px), #FAF7F2",
  },
  abstract_texture: {
    label: "מופשט עם טקסטורה", hint: "שכבות צבע עבות, כמו ציור על קנבס",
    en: "abstract textured acrylic painting, thick layered brush strokes and palette knife marks, rich warm tones",
    swatch: "repeating-linear-gradient(115deg, #B5654A 0 10px, #D99A6C 10px 22px, #8C4B3A 22px 30px)",
  },
  watercolor: {
    label: "צבעי מים", hint: "ציור עדין בצבעי מים",
    en: "soft watercolor painting on textured paper",
    swatch: "linear-gradient(180deg, #CFE3F0 0 50%, #A9C9A4 50%)",
  },
  illustration: {
    label: "איור צבעוני", hint: "איור חם ופשוט",
    en: "warm, colorful flat illustration with gentle shapes",
    swatch: "radial-gradient(circle at 50% 40%, #F6BD60 0 20%, transparent 21%), linear-gradient(180deg, #84A59D 0 65%, #F28482 65%)",
  },
  collage: {
    label: "קולאז' נייר", hint: "גזרי נייר בשכבות",
    en: "cut-paper collage with layered textures",
    swatch: "linear-gradient(160deg, #E9C46A 0 35%, transparent 35%), linear-gradient(20deg, #2A9D8F 0 40%, transparent 40%), #F4A261",
  },
  pastel: {
    label: "פסטל", hint: "ציור בגירי פסטל",
    en: "chalk pastel drawing with visible strokes",
    swatch: "repeating-linear-gradient(80deg, #F7CAD0 0 6px, #FFE5D9 6px 12px, #D8E2DC 12px 18px)",
  },
  photo: {
    label: "צילום", hint: "צילום רך באור טבעי",
    en: "soft, natural-light photograph with shallow depth of field",
    swatch: "linear-gradient(180deg, #FDE2C4 0%, #C9A27E 60%, #5E503F 100%)",
  },
};
export const DEFAULT_STYLE = Object.keys(IMAGE_STYLES)[0];

// נושא ניטרלי לתמונות הדוגמה של כל סגנון
export const STYLE_SAMPLE_PROMPT = "the feeling of hope at sunrise, a quiet new beginning";

// הקשר משותף לכל הקריאות. נכתב בעברית כדי שהצוות יוכל לקרוא ולשנות.
const CONTEXT = `
את/ה משמש/ת עוזר/ת בסדנת מחשבים פרטנית בתוכנית שיקום.
המשתתפת, היאם, יוצרת לאורך השנה אוסף כרטיסים מעוצבים שמבטאים את רעיונותיה ואת גישתה לחיים.
לפרויקט יש נושא-על (יופיע בהודעה), וכל כרטיס עוסק בנושא משנה אחד. המטרה היא להבין איך היאם רואה את נושא המשנה
בתוך נושא-העל, מתוך החיים והניסיון שלה. נושא-העל הוא עדשה ולא מסגרת שכופים עליה: אם היא הולכת לכיוון אחר, הולכים איתה.
בכל מפגש היא בוחרת נושא (למשל פחד, תקווה, חברות, משפחה), מנסחת עליו משפט או שניים משלה,
ומכוונת את עיצוב הכרטיס: תמונה, צבעים וגופן. המדריך מפעיל את המחשב ומקליד את דבריה.
מטרות: לתת תוקף לקולה ולהשקפת עולמה, ולחזק את יכולת התכנון והבחירה שלה.

עקרונות:
- הקול הוא של היאם. לא מוסיפים רעיונות שלא אמרה, לא מתקנים את דעותיה ולא מטיפים.
- עברית פשוטה, חמה ומכבדת, בגוף שני נקבה כשפונים אליה.
- לא מפרשים, לא מאבחנים ולא עושים טיפול. זו סדנת יצירה.
- נותנים לה בחירות ברורות ולא מכריעים במקומה.
`.trim();

function transcriptText(transcript = []) {
  if (!transcript.length) return "(עוד לא נשאלו שאלות)";
  return transcript
    .map((t, i) => `שאלה ${i + 1}: ${t.q}\nתשובת היאם: ${t.a || "(לא ענתה / דילגה)"}`)
    .join("\n\n");
}

async function ask({ system, user, schema, effort = "medium" }) {
  let res;
  try {
    res = await getClient().beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system,
      output_config: { effort, format: betaZodOutputFormat(schema) },
      messages: [{ role: "user", content: user }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      throw new UserFacingError("המפתח של Claude לא תקין. כדאי לבדוק את ANTHROPIC_API_KEY.", 401);
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new UserFacingError("יותר מדי בקשות בבת אחת. נחכה רגע וננסה שוב.", 429);
    }
    if (err instanceof Anthropic.APIConnectionError) {
      throw new UserFacingError("אין חיבור ל-Claude כרגע. כדאי לבדוק את האינטרנט.", 503);
    }
    throw err;
  }
  if (res.stop_reason === "refusal") {
    throw new UserFacingError("Claude לא יכול לעזור עם הבקשה הזו. אפשר לנסח אחרת או להמשיך בלי עזרה.", 422);
  }
  if (!res.parsed_output) {
    throw new UserFacingError("התשובה של Claude לא הגיעה במבנה הצפוי. ננסה שוב.", 502);
  }
  return res.parsed_output;
}

// ---------- 1. שאלה מכווינה ----------

const QuestionSchema = z.object({
  question: z.string().describe("שאלה אחת, קצרה ופתוחה, בעברית פשוטה"),
  simpler: z.string().describe("אותה שאלה בניסוח פשוט עוד יותר, למקרה שקשה לענות"),
  choices: z.array(z.string()).describe("2 עד 4 תשובות קצרות לדוגמה שהיאם יכולה לבחור מהן או לדחות. אפשר רשימה ריקה."),
  ready_to_write: z.boolean().describe("true אם כבר יש מספיק חומר מדבריה כדי לנסח משפט או שניים"),
  pause_suggested: z.boolean().describe("true אם בתשובות עולה מצוקה, והמדריך כדאי שיעצור ויבדוק איתה איך היא מרגישה"),
  note_for_guide: z.string().describe("הערה קצרה למדריך בלבד (לא להקריא). ריק אם אין."),
});

export async function nextQuestion({ theme, topic, transcript }) {
  const system = `${CONTEXT}

התפקיד שלך עכשיו: לשאול את היאם שאלה מכווינה אחת על הנושא שבחרה, כדי לעזור לה לגלות מה היא רוצה לומר.
- שאלה אחת בכל פעם, עד 15 מילים בערך.
- להתחיל משאלות פשוטות וקונקרטיות (רגע, אדם, מקום, תמונה בראש) ורק אחר כך לעבור לשאלות של משמעות.
- להתבסס על מה שכבר אמרה, ולא לחזור על שאלה שכבר נשאלה.
- אם דילגה על שאלה, לשאול משהו קל יותר או מכיוון אחר.
- לאורך השיחה, לפחות שאלה אחת מחברת בעדינות את הנושא לנושא-העל (למשל: איך זה נראה היום, בעולם של טלפונים ומהירות?).
- אחרי 3 עד 5 שאלות בדרך כלל יש מספיק חומר. אז ready_to_write יהיה true.
- אם עולה מצוקה: שאלה רכה מאוד או הצעה להפסקה, ו-pause_suggested יהיה true.`;
  const user = `נושא-העל של הפרויקט: ${theme}\nהנושא שהיאם בחרה לכרטיס: ${topic}\n\nהשיחה עד עכשיו:\n${transcriptText(transcript)}\n\nמה השאלה הבאה?`;
  return ask({ system, user, schema: QuestionSchema, effort: "low" });
}

// ---------- 2. הצעות ניסוח למשפט ----------

const SentencesSchema = z.object({
  options: z.array(z.object({
    text: z.string().describe("משפט אחד או שניים, בגוף ראשון, במילים של היאם"),
    note: z.string().describe("הסבר קצר מאוד למדריך: מאיזה חלק בדבריה זה נלקח"),
  })).describe("3 הצעות שונות זו מזו"),
});

export async function sentenceOptions({ theme, topic, transcript }) {
  const system = `${CONTEXT}

התפקיד שלך עכשיו: להציע 3 ניסוחים למשפט שיופיע על הכרטיס.
- כל הצעה היא משפט אחד או שניים, עד 25 מילים בערך.
- בגוף ראשון נקבה, כאילו היאם אומרת את זה.
- להשתמש כמה שיותר במילים ובביטויים שהיא עצמה אמרה. מותר לקצר ולסדר, אסור להמציא תוכן חדש.
- שלוש הצעות שונות באמת: למשל אחת כמעט מילה במילה, אחת קצרה וחדה, ואחת שמחברת שני רעיונות שלה.
- בלי סימני ציטוט ובלי שם החתימה.`;
  const user = `נושא-העל: ${theme}\nהנושא: ${topic}\n\nהשיחה:\n${transcriptText(transcript)}`;
  return ask({ system, user, schema: SentencesSchema, effort: "medium" });
}

// ---------- 3. רעיונות לתמונה, צבעים וגופן ----------

const DesignSchema = z.object({
  images: z.array(z.object({
    title: z.string().describe("שם קצר לרעיון, 2-4 מילים בעברית"),
    description: z.string().describe("תיאור פשוט בעברית של מה שרואים בתמונה, משפט אחד, כדי שהיאם תוכל לבחור"),
    prompt_en: z.string().describe("English prompt for the image model describing the scene only, 30-60 words"),
  })).describe("3 רעיונות שונים לתמונה"),
  palettes: z.array(z.object({
    name: z.string().describe("שם קצר לפלטה בעברית"),
    background: z.string().describe("hex color, e.g. #F4EDE4"),
    text: z.string().describe("hex color with strong contrast to background"),
    accent: z.string().describe("hex color"),
  })).describe("3 פלטות צבעים שמתאימות לנושא ולתחושה של המשפט"),
  fonts: z.array(z.string()).describe(`2-3 גופנים מתוך הרשימה בלבד: ${FONTS.join(", ")}`),
});

export async function designIdeas({ theme, topic, quote, style }) {
  const key = IMAGE_STYLES[style] ? style : DEFAULT_STYLE;
  const styleInfo = IMAGE_STYLES[key];
  const variety = key.startsWith("abstract")
    ? "- הסגנון מופשט, ולכן שלושת הרעיונות מופשטים: כל אחד מבטא את התחושה של המשפט דרך צבע, צורה, תנועה ואור, בלי חפצים או דמויות מזוהים. שלושה כיוונים שונים זה מזה (למשל צבעים, קצב ותנועה)."
    : "- 3 רעיונות שונים: אחד מוחשי (מקום, חפץ, רגע), אחד סמלי (מטאפורה מהטבע או מהיומיום), ואחד מופשט יותר.";
  const system = `${CONTEXT}

התפקיד שלך עכשיו: להציע להיאם אפשרויות לעיצוב הכרטיס, כדי שהיא תבחר.
תמונות:
${variety}
- הרעיונות נובעים מהמשפט שלה, לא מפרשנות חיצונית.
- ב-prompt_en: בלי טקסט, אותיות או כתובות בתמונה. בלי פנים של אדם מזוהה. אם יש דמויות, הן מרוחקות, מהגב או בצללית.
- ב-prompt_en יש לשלב את הסגנון שבחרה: ${styleInfo.en}.
צבעים: ניגוד חזק בין רקע לטקסט כדי שיהיה קל לקרוא.`;
  const user = `נושא-העל: ${theme}\nהנושא: ${topic}\nהמשפט של היאם: ${quote}\nהסגנון שבחרה: ${styleInfo.label}`;
  const out = await ask({ system, user, schema: DesignSchema, effort: "medium" });
  out.fonts = out.fonts.filter((f) => FONTS.includes(f));
  return out;
}

export function buildImagePrompt(promptEn, style) {
  const styleInfo = IMAGE_STYLES[style] || IMAGE_STYLES[DEFAULT_STYLE];
  return [
    promptEn,
    `Style: ${styleInfo.en}.`,
    "Portrait composition for a greeting-card, calm and respectful mood, warm light.",
    "Absolutely no text, letters, words, numbers or logos anywhere in the image.",
    "No identifiable faces.",
  ].join(" ");
}
