import type { Config, Context } from "@netlify/functions";
import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  Packer,
  PageNumber,
  Paragraph,
  TextRun,
} from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

type Course = {
  title?: string;
  audience?: string;
  goal?: string;
  duration?: string;
  modality?: string;
};

type MaterialItem = {
  title?: string;
  kind?: string;
  content?: string;
  facilitationNotes?: string[];
  transitionPhrases?: string[];
  bullets?: string[];
  speakerNotes?: string;
  activity?: string;
  reflection?: string;
  notesPrompt?: string;
};

type Materials = {
  manual: MaterialItem[];
  slides: MaterialItem[];
  workbook: MaterialItem[];
};

export default async (req: Request, context: Context) => {
  if (req.method !== "POST") {
    return jsonResponse(405, { ok: false, error: "Metodo nao permitido." });
  }

  const payload = await req.json().catch(() => null);

  if (!payload || typeof payload !== "object") {
    return jsonResponse(400, { ok: false, error: "Envio invalido." });
  }

  const format = stringValue((payload as { format?: unknown }).format).toLowerCase();
  const course = asRecord((payload as { course?: unknown }).course) as Course;
  const materials = normalizeMaterials(asRecord((payload as { materials?: unknown }).materials));
  const logoBytes = await fetchLogo(req);

  if (format === "docx") {
    const bytes = await buildDocx(course, materials, logoBytes);
    const filename = `${filenameBase(course)}.docx`;

    return binaryResponse(bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", filename);
  }

  if (format === "pdf") {
    const bytes = await buildPdf(course, materials, logoBytes);
    const filename = `${filenameBase(course)}.pdf`;

    return binaryResponse(bytes, "application/pdf", filename);
  }

  return jsonResponse(400, { ok: false, error: "Formato invalido. Use pdf ou docx." });
};

export const config: Config = {
  path: "/api/export-document",
};

async function buildDocx(course: Course, materials: Materials, logoBytes: Uint8Array | null) {
  const children: Paragraph[] = [];

  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: stringValue(course.title, "Materiais do Curso"), bold: true })],
    }),
    new Paragraph({
      children: [
        new TextRun({
          text: "Manual da Instrutora, Slides e Apostila do Aluno",
          color: "00385F",
          bold: true,
        }),
      ],
    }),
    new Paragraph({
      children: [new TextRun("Material gerado pelo Leste Studio, Universidade do Leste.")],
    }),
  );

  addMetadata(children, course);
  addDocxGroup(children, "Manual da Instrutora", materials.manual, true);
  addDocxGroup(children, "Slides", materials.slides, true);
  addDocxGroup(children, "Apostila do Aluno", materials.workbook, true);

  children.push(
    new Paragraph({
      pageBreakBefore: true,
      heading: HeadingLevel.HEADING_1,
      children: [new TextRun("Universidade do Leste")],
    }),
    new Paragraph({
      children: [
        new TextRun(
          "A Universidade do Leste agradece sua participacao e incentiva a continuidade do aprendizado com pratica, clareza e compromisso institucional.",
        ),
      ],
    }),
  );

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: { font: "Aptos", size: 22, color: "172331" },
          paragraph: { spacing: { after: 160, line: 300 } },
        },
      },
      paragraphStyles: [
        {
          id: "Title",
          name: "Title",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Aptos Display", size: 46, bold: true, color: "00385F" },
          paragraph: { spacing: { before: 80, after: 180 } },
        },
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Aptos Display", size: 32, bold: true, color: "00385F" },
          paragraph: { spacing: { before: 300, after: 120 } },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: { font: "Aptos", size: 25, bold: true, color: "004A7C" },
          paragraph: { spacing: { before: 180, after: 90 } },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 900, right: 900, bottom: 820, left: 900 },
          },
        },
        headers: { default: buildDocxHeader(logoBytes) },
        footers: { default: buildDocxFooter() },
        children,
      },
    ],
  });

  return new Uint8Array(await Packer.toBuffer(doc));
}

function addMetadata(children: Paragraph[], course: Course) {
  const records = [
    ["Publico", course.audience],
    ["Objetivo", course.goal],
    ["Carga horaria", course.duration],
    ["Modalidade", course.modality],
  ].filter((record) => stringValue(record[1]));

  if (!records.length) return;

  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_2,
      children: [new TextRun("Visao geral")],
    }),
  );

  records.forEach(([label, value]) => {
    children.push(
      new Paragraph({
        children: [
          new TextRun({ text: `${label}: `, bold: true, color: "00385F" }),
          new TextRun(stringValue(value)),
        ],
      }),
    );
  });
}

function addDocxGroup(children: Paragraph[], label: string, items: MaterialItem[], pageBreakBefore: boolean) {
  children.push(
    new Paragraph({
      heading: HeadingLevel.HEADING_1,
      pageBreakBefore,
      children: [new TextRun(label)],
    }),
  );

  items.forEach((item, index) => {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_2,
        children: [new TextRun(`${index + 1}. ${stringValue(item.title, "Secao")}`)],
      }),
    );

    pushDocxParagraph(children, item.content);
    pushDocxList(children, item.bullets);
    pushDocxList(children, item.facilitationNotes, "Orientacao");
    pushDocxList(children, item.transitionPhrases, "Transicao");
    pushDocxParagraph(children, item.speakerNotes, "Notas da instrutora");
    pushDocxParagraph(children, item.activity, "Atividade");
    pushDocxParagraph(children, item.reflection, "Reflexao");
    pushDocxParagraph(children, item.notesPrompt, "Espaco para anotacoes");
  });
}

function pushDocxParagraph(children: Paragraph[], value?: string, label?: string) {
  const text = stringValue(value);
  if (!text) return;

  children.push(
    new Paragraph({
      children: label
        ? [new TextRun({ text: `${label}: `, bold: true, color: "00385F" }), new TextRun(text)]
        : [new TextRun(text)],
    }),
  );
}

function pushDocxList(children: Paragraph[], values?: string[], label?: string) {
  if (!Array.isArray(values) || !values.length) return;

  if (label) {
    children.push(
      new Paragraph({
        children: [new TextRun({ text: label, bold: true, color: "00385F" })],
      }),
    );
  }

  values.forEach((value) => {
    if (!stringValue(value)) return;
    children.push(
      new Paragraph({
        bullet: { level: 0 },
        children: [new TextRun(stringValue(value))],
      }),
    );
  });
}

function buildDocxHeader(logoBytes: Uint8Array | null) {
  const children = logoBytes
    ? [
        new ImageRun({
          data: logoBytes,
          transformation: { width: 38, height: 38 },
          type: "jpg",
        }),
        new TextRun({ text: "  Leste Studio", bold: true, color: "00385F", size: 22 }),
      ]
    : [new TextRun({ text: "Leste Studio", bold: true, color: "00385F", size: 22 })];

  return new Header({
    children: [
      new Paragraph({
        children,
      }),
    ],
  });
}

function buildDocxFooter() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({ text: "Universidade do Leste | Pagina ", color: "5B6775", size: 18 }),
          new TextRun({ children: [PageNumber.CURRENT], color: "5B6775", size: 18 }),
        ],
      }),
    ],
  });
}

async function buildPdf(course: Course, materials: Materials, logoBytes: Uint8Array | null) {
  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = logoBytes ? await pdf.embedJpg(logoBytes).catch(() => null) : null;

  const size: [number, number] = [595.28, 841.89];
  const margin = 52;
  const colors = {
    blue: rgb(0 / 255, 74 / 255, 124 / 255),
    deep: rgb(0 / 255, 56 / 255, 95 / 255),
    gold: rgb(244 / 255, 194 / 255, 31 / 255),
    text: rgb(23 / 255, 35 / 255, 49 / 255),
    muted: rgb(91 / 255, 103 / 255, 117 / 255),
    pale: rgb(246 / 255, 250 / 255, 252 / 255),
    white: rgb(1, 1, 1),
  };

  let page = pdf.addPage(size);
  let y = size[1] - margin;

  page.drawRectangle({ x: 0, y: 0, width: size[0], height: size[1], color: colors.deep });
  page.drawRectangle({ x: 0, y: 0, width: size[0], height: 18, color: colors.gold });

  if (logo) {
    page.drawImage(logo, { x: margin, y: size[1] - 142, width: 72, height: 72 });
  }

  page.drawText("LESTE STUDIO", { x: margin, y: size[1] - 190, size: 12, font: bold, color: colors.gold });
  let coverTitleY = size[1] - 232;
  drawPdfWrappedText(stringValue(course.title, "Materiais do Curso"), {
    getPage: () => page,
    font: bold,
    size: 28,
    color: colors.white,
    x: margin,
    maxWidth: size[0] - margin * 2,
    lineHeight: 34,
    getY: () => coverTitleY,
    setY: (nextY) => {
      coverTitleY = nextY;
    },
    ensurePage: () => undefined,
  });
  page.drawText("Manual da Instrutora | Slides | Apostila do Aluno", {
    x: margin,
    y: size[1] - 335,
    size: 14,
    font: regular,
    color: colors.white,
  });
  page.drawText("Universidade do Leste", { x: margin, y: 72, size: 15, font: bold, color: colors.white });

  addContentPage();
  drawPdfMetadata(course);
  drawPdfGroup("Manual da Instrutora", materials.manual);
  drawPdfGroup("Slides", materials.slides);
  drawPdfGroup("Apostila do Aluno", materials.workbook);
  drawPdfHeading("Universidade do Leste", 19, true);
  drawPdfParagraph(
    "A Universidade do Leste agradece sua participacao e incentiva a continuidade do aprendizado com pratica, clareza e compromisso institucional.",
  );

  pdf.getPages().forEach((currentPage, index) => {
    currentPage.drawLine({
      start: { x: margin, y: 40 },
      end: { x: size[0] - margin, y: 40 },
      thickness: 0.5,
      color: rgb(225 / 255, 232 / 255, 238 / 255),
    });
    currentPage.drawText(`Universidade do Leste | Pagina ${index + 1}`, {
      x: margin,
      y: 24,
      size: 8,
      font: regular,
      color: colors.muted,
    });
  });

  return await pdf.save();

  function addContentPage() {
    page = pdf.addPage(size);
    page.drawRectangle({ x: 0, y: size[1] - 64, width: size[0], height: 64, color: colors.pale });
    page.drawText("Leste Studio", { x: margin, y: size[1] - 38, size: 12, font: bold, color: colors.deep });
    page.drawText("Universidade do Leste", {
      x: size[0] - margin - 128,
      y: size[1] - 38,
      size: 9,
      font: regular,
      color: colors.muted,
    });
    y = size[1] - 96;
  }

  function ensureSpace(required: number) {
    if (y - required < 60) addContentPage();
  }

  function drawPdfMetadata(metadata: Course) {
    drawPdfHeading("Visao geral", 18, false);
    [
      ["Publico", metadata.audience],
      ["Objetivo", metadata.goal],
      ["Carga horaria", metadata.duration],
      ["Modalidade", metadata.modality],
    ].forEach(([label, value]) => {
      if (!stringValue(value)) return;
      drawPdfParagraph(`${label}: ${value}`);
    });
  }

  function drawPdfGroup(label: string, items: MaterialItem[]) {
    drawPdfHeading(label, 19, true);

    items.forEach((item, index) => {
      drawPdfHeading(`${index + 1}. ${stringValue(item.title, "Secao")}`, 13, false);
      drawPdfParagraph(item.content);
      drawPdfBullets(item.bullets);
      drawPdfBullets(item.facilitationNotes, "Orientacao");
      drawPdfBullets(item.transitionPhrases, "Transicao");
      drawPdfParagraph(item.speakerNotes, "Notas da instrutora");
      drawPdfParagraph(item.activity, "Atividade");
      drawPdfParagraph(item.reflection, "Reflexao");
      drawPdfParagraph(item.notesPrompt, "Espaco para anotacoes");
      y -= 6;
    });
  }

  function drawPdfHeading(text: string, fontSize: number, newPage: boolean) {
    if (newPage && y < size[1] - 110) addContentPage();
    ensureSpace(42);
    page.drawText(cleanPdfText(text), { x: margin, y, size: fontSize, font: bold, color: colors.deep });
    y -= fontSize + 12;
    page.drawRectangle({ x: margin, y: y + 4, width: 54, height: 3, color: colors.gold });
    y -= 10;
  }

  function drawPdfParagraph(value?: string, label?: string) {
    const text = label && stringValue(value) ? `${label}: ${value}` : stringValue(value);
    if (!text) return;

    drawPdfWrappedText(text, {
      getPage: () => page,
      font: regular,
      size: 10.5,
      color: colors.text,
      x: margin,
      maxWidth: size[0] - margin * 2,
      lineHeight: 15,
      getY: () => y,
      setY: (nextY) => {
        y = nextY - 5;
      },
      ensurePage: ensureSpace,
    });
  }

  function drawPdfBullets(values?: string[], label?: string) {
    if (!Array.isArray(values) || !values.length) return;

    if (label) {
      ensureSpace(24);
      page.drawText(cleanPdfText(label), { x: margin, y, size: 10.5, font: bold, color: colors.deep });
      y -= 16;
    }

    values.forEach((value) => {
      if (!stringValue(value)) return;
      ensureSpace(18);
      page.drawText("-", { x: margin + 4, y, size: 9, font: bold, color: colors.gold });
      drawPdfWrappedText(value, {
        getPage: () => page,
        font: regular,
        size: 10,
        color: colors.text,
        x: margin + 18,
        maxWidth: size[0] - margin * 2 - 18,
        lineHeight: 14,
        getY: () => y,
        setY: (nextY) => {
          y = nextY - 2;
        },
        ensurePage: ensureSpace,
      });
    });
  }
}

function drawPdfWrappedText(
  text: string,
  options: {
    getPage: () => ReturnType<PDFDocument["addPage"]>;
    font: Awaited<ReturnType<PDFDocument["embedFont"]>>;
    size: number;
    color: ReturnType<typeof rgb>;
    x: number;
    maxWidth: number;
    lineHeight: number;
    getY: () => number;
    setY: (y: number) => void;
    ensurePage: (space: number) => void;
  },
) {
  let y = options.getY();
  const paragraphs = stringValue(text)
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  paragraphs.forEach((paragraph) => {
    const lines = wrapPdfText(paragraph, options.font, options.size, options.maxWidth);
    lines.forEach((line) => {
      options.ensurePage(options.lineHeight + 8);
      y = options.getY();
      options.getPage().drawText(cleanPdfText(line), {
        x: options.x,
        y,
        size: options.size,
        font: options.font,
        color: options.color,
      });
      y -= options.lineHeight;
      options.setY(y);
    });
  });
}

function wrapPdfText(text: string, font: Awaited<ReturnType<PDFDocument["embedFont"]>>, size: number, maxWidth: number) {
  const words = cleanPdfText(text).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  words.forEach((word) => {
    const test = line ? `${line} ${word}` : word;

    if (font.widthOfTextAtSize(test, size) <= maxWidth) {
      line = test;
      return;
    }

    if (line) lines.push(line);
    line = word;
  });

  if (line) lines.push(line);

  return lines;
}

async function fetchLogo(req: Request) {
  try {
    const url = new URL("/assets/logo-universidade-do-leste.jpeg", req.url);
    const response = await fetch(url);
    if (!response.ok) return null;

    return new Uint8Array(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function normalizeMaterials(value: Record<string, unknown>): Materials {
  return {
    manual: normalizeItems(value.manual),
    slides: normalizeItems(value.slides),
    workbook: normalizeItems(value.workbook),
  };
}

function normalizeItems(value: unknown) {
  return Array.isArray(value) ? (value.map((item) => asRecord(item)) as MaterialItem[]) : [];
}

function binaryResponse(bytes: Uint8Array, contentType: string, filename: string) {
  return new Response(bytes, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
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

function filenameBase(course: Course) {
  const title = stringValue(course.title, "materiais");
  const slug = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);

  return `leste-studio-${slug || "materiais"}`;
}

function cleanPdfText(text: string) {
  return stringValue(text)
    .normalize("NFC")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\u0009\u000a\u000d\u0020-\u00ff]/g, "");
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}
