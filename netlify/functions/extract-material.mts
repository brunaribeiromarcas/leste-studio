import type { Config, Context } from "@netlify/functions";
import JSZip from "jszip";

type UploadedFile = {
  name?: string;
  type?: string;
  size?: number;
  arrayBuffer?: () => Promise<ArrayBuffer>;
};

type SourceAnalysis = {
  theme: string;
  moduleCount: number;
  lessonCount: number;
  activityCount: number;
  exampleCount: number;
  concepts: string[];
  possibleModules: string[];
  possibleLessons: string[];
};

const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;
const MAX_TEXT_CHARS = 120000;

export default async (req: Request, context: Context) => {
  try {
    if (req.method !== "POST") {
      return jsonResponse(405, { ok: false, error: "Método não permitido." });
    }

    const formData = await req.formData().catch(() => null);
    const file = formData && (formData.get("file") as UploadedFile | null);

    if (!file || typeof file !== "object" || typeof file.arrayBuffer !== "function") {
      return jsonResponse(400, { ok: false, error: "Envie um arquivo PDF, DOCX ou PPTX." });
    }

    const fileName = cleanFileName(file.name || "material");
    const fileType = detectFileType(fileName, file.type || "");
    const size = Number(file.size || 0);

    if (!fileType) {
      return jsonResponse(400, { ok: false, error: "Formato não suportado. Use PDF, DOCX ou PPTX." });
    }

    if (size > MAX_UPLOAD_BYTES) {
      return jsonResponse(413, {
        ok: false,
        error: "Arquivo muito grande para leitura pelo servidor. Envie DOCX/PPTX de até 6 MB ou cole o conteúdo no campo de texto.",
      });
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const extracted = await extractText(bytes, fileType);
    const text = normalizeExtractedText(extracted).slice(0, MAX_TEXT_CHARS);

    if (!text || text.length < 20) {
      return jsonResponse(422, {
        ok: false,
        error: "Não foi possível encontrar texto útil neste arquivo. Tente colar o conteúdo no campo de texto.",
      });
    }

    const analysis = analyzeSourceText(text);

    return jsonResponse(200, {
      ok: true,
      data: {
        fileName,
        fileType,
        charCount: text.length,
        text,
        summary: buildSummary(text, analysis),
        analysis,
      },
    });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: cleanError(error) });
  }
};

export const config: Config = {
  path: "/api/extract-material",
};

async function extractText(bytes: Uint8Array, fileType: string) {
  if (fileType === "pdf") return extractPdfText(bytes);
  if (fileType === "docx") return extractDocxText(bytes);
  if (fileType === "pptx") return extractPptxText(bytes);
  throw new Error("Formato não suportado.");
}

async function extractPdfText(bytes: Uint8Array) {
  const module = await import("pdf-parse/lib/pdf-parse.js");
  const pdfParse = (module.default || module) as (data: Buffer) => Promise<{ text?: string }>;
  const result = await pdfParse(Buffer.from(bytes));

  return result.text || "";
}

async function extractDocxText(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const parts = [
    "word/document.xml",
    ...Object.keys(zip.files).filter((name) => /^word\/(header|footer)\d+\.xml$/i.test(name)).sort(naturalSort),
  ];
  const chunks: string[] = [];

  for (const part of parts) {
    const entry = zip.file(part);
    if (!entry) continue;
    chunks.push(extractWordXmlText(await entry.async("string")));
  }

  return chunks.join("\n\n");
}

async function extractPptxText(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(naturalSort);
  const chunks: string[] = [];

  for (const [index, slideName] of slideNames.entries()) {
    const entry = zip.file(slideName);
    if (!entry) continue;
    const slideText = extractDrawingXmlText(await entry.async("string"));
    if (slideText) chunks.push(`Slide ${index + 1}\n${slideText}`);
  }

  return chunks.join("\n\n");
}

function extractWordXmlText(xml: string) {
  const chunks: string[] = [];
  const pattern = /<w:t[^>]*>([\s\S]*?)<\/w:t>|<w:tab\s*\/>|<w:br\s*\/>|<\/w:p>|<\/w:tr>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(xml))) {
    if (match[1]) {
      chunks.push(decodeXmlEntities(match[1]));
      continue;
    }

    if (/w:tab/i.test(match[0])) {
      chunks.push("\t");
    } else {
      chunks.push("\n");
    }
  }

  return chunks.join("");
}

function extractDrawingXmlText(xml: string) {
  const chunks: string[] = [];
  const pattern = /<a:t[^>]*>([\s\S]*?)<\/a:t>|<\/a:p>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(xml))) {
    chunks.push(match[1] ? decodeXmlEntities(match[1]) : "\n");
  }

  return chunks.join("");
}

function normalizeExtractedText(text: string) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function analyzeSourceText(text: string): SourceAnalysis {
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headings = lines.filter((line) => isLikelyHeading(line));
  const possibleModules = headings.filter((line) => /\bm[oó]dulo\b/i.test(line)).slice(0, 8);
  const possibleLessons = headings.filter((line) => /\baula\b/i.test(line)).slice(0, 12);

  return {
    theme: inferTheme(lines, headings),
    moduleCount: countMatches(text, /\bm[oó]dulo\b/gi),
    lessonCount: countMatches(text, /\baula\b/gi),
    activityCount: countMatches(text, /\b(atividade|exerc[ií]cio|pr[aá]tica|din[aâ]mica|tarefa)\b/gi),
    exampleCount: countMatches(text, /\b(exemplo|caso|situa[cç][aã]o|cen[aá]rio)\b/gi),
    concepts: inferConcepts(text),
    possibleModules,
    possibleLessons,
  };
}

function inferTheme(lines: string[], headings: string[]) {
  const titleCandidate =
    headings.find((line) => line.length >= 8 && line.length <= 90 && !/\b(slide|p[aá]gina)\b/i.test(line)) ||
    lines.find((line) => line.length >= 8 && line.length <= 90) ||
    "Tema principal do material";

  return titleCandidate.replace(/^\d+[\).:-]?\s*/, "");
}

function isLikelyHeading(line: string) {
  if (line.length < 4 || line.length > 110) return false;
  if (/[.!?]$/.test(line) && line.length > 48) return false;
  return (
    /^\d+[\).:-]?\s+/.test(line) ||
    /\b(m[oó]dulo|aula|unidade|cap[ií]tulo|parte|tema|atividade|exerc[ií]cio)\b/i.test(line) ||
    line === line.toUpperCase()
  );
}

function inferConcepts(text: string) {
  const words = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/\b[a-z]{5,}\b/g) || [];
  const stopWords = new Set([
    "curso",
    "aula",
    "modulo",
    "sobre",
    "para",
    "como",
    "entre",
    "atividade",
    "material",
    "aluno",
    "alunos",
    "participantes",
    "universidade",
    "leste",
    "slide",
    "slides",
  ]);
  const frequency = new Map<string, number>();

  words.forEach((word) => {
    if (!stopWords.has(word)) frequency.set(word, (frequency.get(word) || 0) + 1);
  });

  return Array.from(frequency.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([word]) => word)
    .slice(0, 12);
}

function buildSummary(text: string, analysis: SourceAnalysis) {
  const firstLine = text
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 12);
  const signals = [
    analysis.moduleCount ? `${analysis.moduleCount} menções a módulos` : "",
    analysis.lessonCount ? `${analysis.lessonCount} menções a aulas` : "",
    analysis.activityCount ? `${analysis.activityCount} atividades ou exercícios` : "",
    analysis.exampleCount ? `${analysis.exampleCount} exemplos ou casos` : "",
  ].filter(Boolean);

  return [
    `Tema provável: ${analysis.theme}.`,
    firstLine ? `Trecho inicial: ${firstLine.slice(0, 180)}${firstLine.length > 180 ? "..." : ""}` : "",
    signals.length ? `Sinais encontrados: ${signals.join(", ")}.` : "A estrutura será interpretada pela IA.",
  ]
    .filter(Boolean)
    .join(" ");
}

function detectFileType(fileName: string, mimeType: string) {
  const name = fileName.toLowerCase();
  const type = mimeType.toLowerCase();

  if (name.endsWith(".pdf") || type.includes("pdf")) return "pdf";
  if (name.endsWith(".docx") || type.includes("wordprocessingml")) return "docx";
  if (name.endsWith(".pptx") || type.includes("presentationml")) return "pptx";
  return "";
}

function decodeXmlEntities(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function naturalSort(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function countMatches(text: string, regex: RegExp) {
  return (String(text || "").match(regex) || []).length;
}

function cleanFileName(name: string) {
  return String(name || "material").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 140);
}

function jsonResponse(status: number, data: unknown) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function cleanError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
