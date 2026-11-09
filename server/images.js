// יצירת תמונות. הספק נבחר לפי IMAGE_PROVIDER (openai או gemini).
// התמונות נשמרות כקבצי PNG בתיקייה data/images, וכך אפשר גם להעלות אותן לקנבה.
import fs from "node:fs/promises";
import path from "node:path";
import { IMAGES_DIR, newId } from "./store.js";
import { UserFacingError } from "./ai.js";

export function imageProvider() {
  return (process.env.IMAGE_PROVIDER || "openai").toLowerCase();
}

export function imageKeyConfigured() {
  return imageProvider() === "gemini"
    ? Boolean(process.env.GEMINI_API_KEY)
    : Boolean(process.env.OPENAI_API_KEY);
}

async function generateOpenAI(prompt) {
  if (!process.env.OPENAI_API_KEY) {
    throw new UserFacingError("חסר מפתח ליצירת תמונות. יש להוסיף OPENAI_API_KEY לקובץ ‎.env.");
  }
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI();
  const res = await client.images.generate({
    model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1.5",
    prompt,
    size: "1024x1536",
    n: 1,
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new UserFacingError("לא התקבלה תמונה. ננסה שוב.", 502);
  return Buffer.from(b64, "base64");
}

async function generateGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) {
    throw new UserFacingError("חסר מפתח ליצירת תמונות. יש להוסיף GEMINI_API_KEY לקובץ ‎.env.");
  }
  const { GoogleGenAI } = await import("@google/genai");
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const res = await ai.models.generateContent({
    model: process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image",
    contents: prompt,
    config: { imageConfig: { aspectRatio: "2:3" } },
  });
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const img = parts.find((p) => p.inlineData?.data);
  if (!img) throw new UserFacingError("לא התקבלה תמונה. אפשר לנסות ניסוח אחר.", 502);
  return Buffer.from(img.inlineData.data, "base64");
}

export async function generateImage(prompt) {
  let buf;
  try {
    buf = imageProvider() === "gemini" ? await generateGemini(prompt) : await generateOpenAI(prompt);
  } catch (err) {
    if (err instanceof UserFacingError) throw err;
    console.error("image generation failed:", err);
    const status = err?.status;
    if (status === 401) throw new UserFacingError("מפתח התמונות לא תקין.", 401);
    if (status === 400) throw new UserFacingError("ספק התמונות דחה את הבקשה. אפשר לנסות רעיון אחר.", 422);
    if (status === 429) throw new UserFacingError("יותר מדי בקשות לתמונות. נחכה רגע.", 429);
    throw new UserFacingError("יצירת התמונה נכשלה. ננסה שוב.", 502);
  }
  const file = `${newId()}.png`;
  await fs.writeFile(path.join(IMAGES_DIR, file), buf);
  return file;
}
