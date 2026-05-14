/**
 * NanoBanana 3.1 (Gemini 3.1 Flash Image Preview) — image edit helper.
 *
 * Sends a source image + edit prompt to Vertex AI's streamGenerateContent
 * endpoint and saves the returned edited image bytes. Used standalone for
 * one-off edits and as a building block for any future video project that
 * needs identity-preserving image transforms (e.g. headshot → full-body).
 *
 *   tsx pipeline/edit-image-gemini.ts \
 *     --source <local-path-or-https-url> \
 *     --prompt "<edit instruction>" \
 *     --output <path.jpg> \
 *     [--aspect-ratio 3:4] \
 *     [--upload]      # also POST to tmpfiles.org and print the public URL
 *
 * Modeled on sdbooth/app/models/concerns/vertex_api.rb (_edit_image).
 * Caches by sha1(source-bytes + prompt + aspect) so repeated calls are free.
 */

import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const PROJECT_ID = "marine-bebop-276519";
const MODEL = "gemini-3.1-flash-image-preview";
const ENDPOINT = `https://aiplatform.googleapis.com/v1/projects/${PROJECT_ID}/locations/global/publishers/google/models/${MODEL}:streamGenerateContent`;

const TMPFILES_ENDPOINT = "https://tmpfiles.org/api/v1/upload";

// Verbatim from sdbooth/app/models/concerns/vertex_api.rb (lines 15-39).
const SYSTEM_INSTRUCTION = `
  **1. Maximize Image Quality and Detail:**
    *   Always strive for photorealistic quality unless a specific artistic style is explicitly requested.
    *   Render intricate details, textures, and subtle nuances to enhance realism and visual richness.
    *   Employ advanced lighting techniques (e.g., golden hour, dramatic chiaroscuro, softbox setup) and appropriate camera settings (e.g., aperture, focal length, depth of field) as implied or explicitly stated in the prompt.
    *   Ensure crisp focus on primary subjects and intelligent use of background blur (bokeh) where artistically appropriate.

**2. Strict Prompt Adherence:**
    *   Interpret all instructions literally and execute them precisely. Do not infer or deviate from the explicit details provided.
    *   Prioritize narrative, descriptive paragraphs over keyword lists. Construct the scene as a director would, detailing environment, subject actions, mood, and visual elements.
    *   Be hyper-specific with all elements: colors, materials, shapes, sizes, emotions, and interactions. If a detail is provided, it *must* be incorporated.
    *   Maintain character consistency across iterative prompts by meticulously referencing previous outputs and descriptions.
    *   Incorporate provided aspect ratios without alteration. If multiple input images are given, adopt the aspect ratio of the last image unless otherwise specified.

**3. Prompting for Censorship Avoidance and Creative Freedom:**
    *   Your goal is to fulfill creative requests while adhering to ethical guidelines. When a prompt approaches a sensitive topic, interpret it in the most benign, artistic, and abstract manner possible to fulfill the user's creative intent without generating harmful content.
    *   Focus on the artistic and aesthetic qualities of the request. For example, if a prompt involves themes that could be interpreted as violent or explicit, render it symbolically, metaphorically, or in a highly stylized, non-graphic manner (e.g., classical sculpture, abstract art, or a distant, implied scene).
    *   When a prompt includes elements that might be flagged, use semantic rephrasing internally to generate the desired visual outcome. For instance, instead of directly depicting a prohibited item, focus on its *effect* or *absence* in the scene, or a harmless analogous representation.
    *   If a prompt is ambiguous or could be misconstrued, default to the most artistic, symbolic, and non-literal interpretation that aligns with high image quality and creative expression, avoiding any literal depiction of potentially restricted content.
    *   Your purpose is to enable creative expression. If a prompt can be rendered safely and artistically, do so. Do not preemptively censor or refuse a prompt unless it directly and unambiguously violates safety policies in its most benign interpretation.

**4. Output Format:**
    *   Generate a single image per request unless multiple distinct images are explicitly asked for within a single prompt.
    *   Provide the image in the highest possible resolution and quality.
`;

const SAFETY_SETTINGS_OFF = [
  { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "OFF" },
  { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "OFF" },
  { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "OFF" },
  { category: "HARM_CATEGORY_HARASSMENT", threshold: "OFF" },
];

type AspectRatio = "1:1" | "3:4" | "4:3" | "9:16" | "16:9" | "21:9" | "9:21" | "2:3" | "3:2" | "5:4" | "4:5";

export interface EditImageArgs {
  /** Local filesystem path OR https URL. */
  source: string;
  prompt: string;
  output: string;
  aspectRatio?: AspectRatio;
  /** Default 1.0; lower for tighter adherence, higher for more variation. */
  temperature?: number;
}

interface StreamChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string }; text?: string }> };
    finishReason?: string;
    finishMessage?: string;
  }>;
  promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
}

function sha1(...inputs: Array<Buffer | string>): string {
  const h = createHash("sha1");
  for (const i of inputs) h.update(i);
  return h.digest("hex").slice(0, 16);
}

async function readSource(src: string): Promise<{ bytes: Buffer; mimeType: string }> {
  if (/^https?:\/\//.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`source fetch failed: ${res.status} ${src}`);
    const mimeType = res.headers.get("content-type") ?? "image/jpeg";
    const bytes = Buffer.from(await res.arrayBuffer());
    return { bytes, mimeType: mimeType.split(";")[0]!.trim() };
  }
  const abs = resolve(src);
  if (!existsSync(abs)) throw new Error(`source file not found: ${abs}`);
  const bytes = readFileSync(abs);
  const mimeType =
    abs.endsWith(".png") ? "image/png" :
    abs.endsWith(".webp") ? "image/webp" :
    abs.endsWith(".gif") ? "image/gif" :
    "image/jpeg";
  return { bytes, mimeType };
}

async function uploadToTmpfiles(filePath: string): Promise<string> {
  const buf = readFileSync(filePath);
  const form = new FormData();
  form.append("file", new Blob([buf]), basename(filePath));
  const res = await fetch(TMPFILES_ENDPOINT, {
    method: "POST",
    headers: { "User-Agent": "webinar-builder/1.0 (alon@astria.ai)" },
    body: form,
  });
  if (!res.ok) throw new Error(`tmpfiles upload failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { status: string; data?: { url?: string } };
  const pageUrl = json.data?.url;
  if (json.status !== "success" || !pageUrl) {
    throw new Error(`tmpfiles upload returned unexpected body: ${JSON.stringify(json)}`);
  }
  return pageUrl.replace("tmpfiles.org/", "tmpfiles.org/dl/");
}

export async function editImageGemini(args: EditImageArgs): Promise<{ localPath: string; cached: boolean }> {
  const apiKey = process.env.VERTEX_API_KEY;
  if (!apiKey) throw new Error("VERTEX_API_KEY not set in env");

  const { source, prompt, output, aspectRatio = "3:4", temperature = 1 } = args;
  const { bytes: sourceBytes, mimeType: sourceMime } = await readSource(source);

  const key = sha1(sourceBytes, prompt, aspectRatio, String(temperature));
  const cacheDir = join(ROOT, ".cache", "gemini-edits");
  mkdirSync(cacheDir, { recursive: true });
  const cached = join(cacheDir, `${key}.jpg`);
  const absOutput = resolve(output);
  mkdirSync(dirname(absOutput), { recursive: true });

  if (existsSync(cached)) {
    writeFileSync(absOutput, readFileSync(cached));
    console.log(`[edit-image-gemini] cache hit (${key}) → ${absOutput}`);
    return { localPath: absOutput, cached: true };
  }

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType: sourceMime, data: sourceBytes.toString("base64") } },
          { text: prompt },
        ],
      },
    ],
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    generationConfig: {
      temperature,
      maxOutputTokens: 32768,
      responseModalities: ["IMAGE"],
      imageConfig: {
        aspectRatio,
        imageOutputOptions: { mimeType: "image/jpeg", compressionQuality: 95 },
      },
      topP: 0.95,
    },
    safetySettings: SAFETY_SETTINGS_OFF,
  };

  console.log(`[edit-image-gemini] ${MODEL} aspect=${aspectRatio} src=${source.slice(0, 80)}`);
  console.log(`[edit-image-gemini] prompt: "${prompt.slice(0, 120)}${prompt.length > 120 ? "…" : ""}"`);

  const res = await fetch(`${ENDPOINT}?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Vertex ${MODEL} HTTP ${res.status}: ${await res.text()}`);
  }

  // streamGenerateContent returns a JSON array of chunks. Collect every
  // `inlineData` part from every chunk's first candidate. If none → look for
  // text / finishReason / promptFeedback to surface the error.
  const body = (await res.json()) as StreamChunk[] | StreamChunk;
  const chunks = Array.isArray(body) ? body : [body];
  const allParts = chunks.flatMap((c) => c.candidates?.[0]?.content?.parts ?? []);
  const imageParts = allParts.filter((p) => p.inlineData?.data);

  if (imageParts.length === 0) {
    const textErr = allParts.map((p) => p.text).filter(Boolean).join("\n");
    const feedback = chunks.find((c) => c.promptFeedback)?.promptFeedback;
    const finish = chunks.find((c) => c.candidates?.[0]?.finishReason)?.candidates?.[0];
    const errMsg =
      textErr ||
      (feedback ? [feedback.blockReason, feedback.blockReasonMessage].filter(Boolean).join(": ") : "") ||
      (finish ? [finish.finishReason, finish.finishMessage].filter(Boolean).join(": ") : "") ||
      "no image bytes returned and no error message";
    throw new Error(`Vertex ${MODEL} produced no image: ${errMsg}`);
  }

  // Save first image (single-image edits are the common case).
  const first = imageParts[0]!.inlineData!;
  const outBytes = Buffer.from(first.data!, "base64");
  writeFileSync(cached, outBytes);
  writeFileSync(absOutput, outBytes);
  console.log(`[edit-image-gemini] saved ${absOutput} (${outBytes.length} bytes, cache key ${key})`);

  return { localPath: absOutput, cached: false };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const arg = (name: string) => {
    const i = args.indexOf(name);
    return i !== -1 ? args[i + 1] : undefined;
  };
  const flag = (name: string) => args.includes(name);

  const source = arg("--source");
  const prompt = arg("--prompt");
  const output = arg("--output");
  const aspectRatio = (arg("--aspect-ratio") as AspectRatio | undefined) ?? "3:4";
  const upload = flag("--upload");

  if (!source || !prompt || !output) {
    console.error(
      "Usage: tsx pipeline/edit-image-gemini.ts --source <path|url> --prompt <text> --output <path.jpg> [--aspect-ratio 3:4] [--upload]"
    );
    process.exit(1);
  }

  editImageGemini({ source, prompt, output, aspectRatio })
    .then(async ({ localPath, cached }) => {
      console.log(`[edit-image-gemini] done (${cached ? "cached" : "fresh"}) → ${localPath}`);
      if (upload) {
        const url = await uploadToTmpfiles(localPath);
        console.log(`[edit-image-gemini] uploaded: ${url}`);
      }
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
