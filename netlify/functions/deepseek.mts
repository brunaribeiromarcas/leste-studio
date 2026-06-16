import type { Config, Context } from "@netlify/functions";

declare const Netlify: {
  env: {
    get(key: string): string | undefined;
  };
};

type DeepSeekConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
  timeoutMs: number;
};

type CompletionResult = {
  ok: boolean;
  status?: number;
  error?: string;
  data?: {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
    usage?: unknown;
  };
};

type Matrix = {
  modules: Array<{
    title: string;
    objective: string;
    introduction: string;
    lessons: Array<{
      title: string;
      objective: string;
      development: string;
      examples: string[];
      reflection: string;
      exercise: string;
      opening: string;
      transition: string;
      closing: string;
    }>;
  }>;
};

export default async (req: Request, context: Context) => {
  try {
    const url = new URL(req.url);

    if (url.pathname === "/api/health" && req.method === "GET") {
      return jsonResponse(200, {
        ok: true,
        configured: Boolean(getConfig().apiKey),
        provider: "DeepSeek",
        model: getConfig().model,
        baseUrl: getConfig().baseUrl,
      });
    }

    if (url.pathname === "/api/deepseek-test" && req.method === "GET") {
      return await handleDeepSeekTest();
    }

    if (url.pathname === "/api/generate" && req.method === "POST") {
      return await handleGenerate(req);
    }

    return jsonResponse(404, { ok: false, error: "Endpoint não encontrado." });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: cleanError(error) });
  }
};

export const config: Config = {
  path: ["/api/health", "/api/deepseek-test", "/api/generate"],
};

async function handleGenerate(req: Request) {
  const config = getConfig();

  if (!config.apiKey) {
    return jsonResponse(503, {
      ok: false,
      error: "A chave da API não está configurada na Netlify.",
      hint: "Configure a variável DEEPSEEK_API_KEY no projeto Netlify.",
    });
  }

  const body = await req.json().catch(() => null);

  if (!body || typeof body !== "object") {
    return jsonResponse(400, { ok: false, error: "Envio inválido." });
  }

  const task = String((body as { task?: unknown }).task || "");
  const startedAt = Date.now();
  const messages = buildMessages(task, body as Record<string, unknown>);

  if (!messages) {
    return jsonResponse(400, { ok: false, error: "Tarefa de geração inválida." });
  }

  const completion = await callDeepSeek(messages, config, task);
  const parsed = parseJsonContent(completion.content);
  const data = completeGeneratedData(task, parsed, body as Record<string, unknown>);

  return jsonResponse(200, {
    ok: true,
    model: config.model,
    task,
    usage: completion.usage || null,
    elapsedMs: Date.now() - startedAt,
    data,
  });
}

async function handleDeepSeekTest() {
  const config = getConfig();

  if (!config.apiKey) {
    return jsonResponse(503, {
      ok: false,
      configured: false,
      provider: "DeepSeek",
      model: config.model,
      baseUrl: config.baseUrl,
      error: "A chave da API não está configurada na Netlify.",
      hint: "Configure DEEPSEEK_API_KEY nas variáveis de ambiente do site.",
    });
  }

  const tests = [];
  const modelsResult = await getDeepSeekModels(config);
  tests.push({
    name: "Listar modelos",
    ok: modelsResult.ok,
    status: modelsResult.status || null,
    error: modelsResult.error || null,
  });

  const generationResult = await postCompletion(
    {
      model: config.model,
      messages: [
        { role: "system", content: "Responda somente JSON válido." },
        { role: "user", content: "{\"ok\":true,\"mensagem\":\"DeepSeek conectado\"}" },
      ],
      thinking: { type: "disabled" },
      temperature: 0,
      max_tokens: 120,
      response_format: { type: "json_object" },
    },
    config,
  );

  tests.push({
    name: "Geração mínima",
    ok: generationResult.ok,
    status: generationResult.status || null,
    error: generationResult.error || null,
  });

  const ok = tests.every((test) => test.ok);
  const firstError = tests.find((test) => !test.ok);
  const network = ok ? null : await testPublicInternet(config);

  return jsonResponse(ok ? 200 : 502, {
    ok,
    configured: true,
    provider: "DeepSeek",
    model: config.model,
    baseUrl: config.baseUrl,
    tests,
    network,
    hint: ok
      ? "DeepSeek conectado corretamente."
      : getDeepSeekHint(firstError && firstError.error, firstError && firstError.status, network),
  });
}

function buildMessages(task: string, payload: Record<string, unknown>) {
  const course = asRecord(payload.course);
  const matrix = completeMatrix(payload.matrix);
  const materials = asRecord(payload.materials);
  const source = normalizeSourceMaterial(payload.sourceMaterial);
  const mode = source.hasContent ? "transformar material existente" : "criar curso do zero";

  const baseContext = {
    modo: mode,
    nomeDoCurso: stringValue(course.title, "Curso sem título"),
    publico: stringValue(course.audience),
    objetivo: stringValue(course.goal),
    cargaHoraria: stringValue(course.duration),
    modalidade: stringValue(course.modality),
    tom: stringValue(course.tone, "acolhedor, profissional, claro e institucional"),
    contexto: stringValue(course.context),
    conteudosBase: stringValue(course.source),
    materialExistente: source.hasContent
      ? {
          arquivo: source.fileName,
          tipo: source.fileType,
          resumo: source.summary,
          analise: source.analysis,
          texto: source.text,
        }
      : null,
    marca: {
      nome: "Universidade do Leste",
      produto: "Leste Studio",
      identidade: "educacional, institucional, moderna, acolhedora e premium",
      estruturaObrigatoria:
        "4 módulos, 2 aulas por módulo, introdução de módulo, encerramento do curso e menção institucional final",
    },
  };

  const system = [
    "Você é o motor pedagógico do Leste Studio, plataforma oficial da Universidade do Leste.",
    "Gere materiais em Português do Brasil, com acentuação correta, linguagem natural, tom acolhedor e padrão institucional.",
    "Use design instrucional para adultos, clareza didática, progressão por objetivos, exemplos práticos e atividades aplicáveis.",
    "Responda exclusivamente com JSON válido, sem markdown, sem comentários fora do JSON e sem texto antes ou depois.",
    "Não invente promessas comerciais, certificações, leis, dados ou nomes de pessoas. Quando faltar informação, use formulações neutras e editáveis.",
    source.hasContent
      ? "Como há material existente, preserve a intenção, conceitos, exemplos e atividades originais sempre que forem úteis; melhore estrutura, clareza e completude sem apagar a essência do conteúdo recebido."
      : "Como não há material existente, crie o curso do zero com profundidade pedagógica, estrutura 4x2 completa e exemplos plausíveis, sem fingir que existe uma fonte anterior.",
  ].join(" ");

  if (task === "matrix") {
    return [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          tarefa: source.hasContent
            ? "Interpretar o material existente e convertê-lo em matriz pedagógica 4x2."
            : "Criar a matriz pedagógica completa do curso do zero.",
          contexto: baseContext,
          formatoObrigatorio: {
            modules: [
              {
                title: "Nome do módulo",
                objective: "Objetivo do módulo",
                introduction: "Texto de introdução do módulo",
                lessons: [
                  {
                    title: "Nome da aula",
                    objective: "Objetivo da aula",
                    development: "Desenvolvimento do tema",
                    examples: ["Exemplo prático"],
                    reflection: "Pergunta de reflexão",
                    exercise: "Exercício prático",
                    opening: "Frase de abertura",
                    transition: "Frase de transição",
                    closing: "Frase de encerramento",
                  },
                ],
              },
            ],
          },
          regras: [
            "Criar exatamente 4 módulos.",
            "Cada módulo deve ter exatamente 2 aulas.",
            "As aulas devem evoluir de fundamentos para aplicação prática.",
            source.hasContent
              ? "Reorganizar o material recebido sem descaracterizar o conteúdo original."
              : "Criar um percurso completo a partir dos dados informados.",
            "Manter textos claros, objetivos e úteis para geração de Manual, Slides, Apostila e Divulgação.",
          ],
        }),
      },
    ];
  }

  if (task === "materials") {
    return [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          tarefa: source.hasContent
            ? "Gerar os materiais faltantes a partir do material existente, preservando e melhorando a base original."
            : "Gerar Manual da Instrutora, Slides, Apostila do Aluno e materiais de divulgação do zero.",
          contexto: baseContext,
          matriz: matrix,
          formatoObrigatorio: {
            manual: [
              {
                title: "Título da seção",
                kind: "abertura | modulo | aula | exercicio | encerramento",
                content: "Texto orientativo para a instrutora",
                facilitationNotes: ["Orientação de condução"],
                transitionPhrases: ["Frase de transição"],
              },
            ],
            slides: [
              {
                title: "Título do slide",
                kicker: "Marcador curto",
                bullets: ["Ponto visual e objetivo"],
                speakerNotes: "Notas para fala da instrutora",
              },
            ],
            workbook: [
              {
                title: "Título da seção",
                content: "Texto da apostila do aluno",
                activity: "Atividade prática",
                reflection: "Reflexão",
                notesPrompt: "Espaço para anotações",
              },
            ],
            marketing: [
              {
                title: "Nome da peça ou bloco",
                content: "Texto de divulgação",
                channels: ["Canal recomendado"],
                assets: ["Peça sugerida"],
              },
            ],
            canva: {
              templateGuidance: ["Orientação para montar os materiais no Canva"],
            },
          },
          regras: [
            "O Manual deve orientar abertura, condução, desenvolvimento, exemplos, reflexões, exercícios, transições e encerramento.",
            "Os Slides devem ser visuais, objetivos e com pouco texto por slide.",
            "A Apostila deve conter boas-vindas, visão geral, resumos, exercícios, reflexões, atividades e espaços para anotações.",
            "Os materiais de divulgação devem incluir chamada curta, descrição do curso, benefícios e sugestões de peças/canais.",
            "Encerrar todos os materiais com menção institucional à Universidade do Leste.",
            source.hasContent
              ? "Citar e preservar conceitos do material recebido, completando lacunas pedagógicas."
              : "Criar conteúdo completo e coerente, sem depender de material prévio.",
          ],
        }),
      },
    ];
  }

  if (task === "review") {
    return [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          tarefa: "Revisar criticamente os materiais e devolver versão melhorada.",
          contexto: baseContext,
          materiais: materials,
          formatoObrigatorio: {
            review: {
              score: "nota de 0 a 100",
              strengths: ["ponto forte"],
              improvements: ["melhoria aplicada"],
              risks: ["risco de clareza, pedagogia ou consistência"],
            },
            materials: "Mesma estrutura recebida, revisada em pt-BR.",
          },
          regras: [
            "Corrigir ortografia, gramática, acentuação e naturalidade em pt-BR.",
            "Melhorar clareza, consistência pedagógica e tom institucional.",
            "Não remover a estrutura 4x2, os materiais de divulgação nem a menção institucional final.",
            source.hasContent
              ? "Conferir se a essência do material original foi preservada."
              : "Conferir se o curso criado do zero tem profundidade suficiente.",
          ],
        }),
      },
    ];
  }

  return null;
}

async function callDeepSeek(messages: unknown[], config: DeepSeekConfig, task: string) {
  const payload = {
    model: config.model,
    messages,
    thinking: { type: "disabled" },
    temperature: task === "review" ? 0.25 : 0.45,
    max_tokens: maxTokensForTask(task),
    response_format: { type: "json_object" },
  };

  let result = await postCompletion(payload, config);

  if (!result.ok && /thinking|response_format/i.test(result.error || "")) {
    const retryPayload = { ...payload };
    if (/thinking/i.test(result.error || "")) delete (retryPayload as { thinking?: unknown }).thinking;
    if (/response_format/i.test(result.error || "")) {
      delete (retryPayload as { response_format?: unknown }).response_format;
    }
    result = await postCompletion(retryPayload, config);
  }

  if (!result.ok) {
    throw new Error(`${result.error || "Falha na geração com IA."} ${getDeepSeekHint(result.error, result.status)}`);
  }

  const choice = result.data && result.data.choices && result.data.choices[0];
  const content = choice && choice.message && choice.message.content;

  if (!content) {
    throw new Error("A IA não retornou conteúdo utilizável.");
  }

  return {
    content,
    usage: result.data && result.data.usage,
  };
}

function maxTokensForTask(task: string) {
  if (task === "matrix") return 2600;
  if (task === "review") return 4200;
  return 7200;
}

function completeGeneratedData(task: string, data: unknown, payload: Record<string, unknown>) {
  if (task === "matrix") return completeMatrix(data);
  if (task === "materials") return completeMaterialsFromData(data, payload);
  if (task === "review") return completeReviewData(data, payload);
  return data;
}

function completeReviewData(data: unknown, payload: Record<string, unknown>) {
  const record = asRecord(data);
  const fallbackMaterials = completeMaterialsFromData(record.materials || payload.materials || {}, payload);

  return {
    review: asRecord(record.review || {
      score: "em análise",
      strengths: ["Materiais revisados em estrutura institucional."],
      improvements: ["Padronização pedagógica aplicada."],
      risks: [],
    }),
    materials: record.materials ? completeMaterialsFromData(record.materials, payload) : fallbackMaterials,
  };
}

function completeMatrix(data: unknown): Matrix {
  const source = asRecord(data);
  const modules = Array.isArray(source.modules) ? source.modules.slice(0, 4) : [];

  while (modules.length < 4) {
    modules.push({});
  }

  return {
    modules: modules.map((moduleItem, moduleIndex) => {
      const moduleRecord = asRecord(moduleItem);
      const lessons = Array.isArray(moduleRecord.lessons) ? moduleRecord.lessons.slice(0, 2) : [];

      while (lessons.length < 2) {
        lessons.push({});
      }

      const moduleTitle = stringValue(moduleRecord.title, `Módulo ${moduleIndex + 1}`);
      const moduleObjective = stringValue(
        moduleRecord.objective,
        "Organizar conceitos e práticas essenciais para aplicação em contexto real.",
      );

      return {
        title: moduleTitle,
        objective: moduleObjective,
        introduction: stringValue(
          moduleRecord.introduction,
          `Neste módulo, a turma conecta ${moduleTitle.toLowerCase()} à prática profissional.`,
        ),
        lessons: lessons.map((lessonItem, lessonIndex) => {
          const lessonRecord = asRecord(lessonItem);
          const lessonTitle = stringValue(lessonRecord.title, `Aula ${lessonIndex + 1}`);
          const lessonObjective = stringValue(
            lessonRecord.objective,
            "Compreender o tema e transformar o aprendizado em uma ação prática.",
          );

          return {
            title: lessonTitle,
            objective: lessonObjective,
            development: stringValue(
              lessonRecord.development,
              `Conduza a aula relacionando ${lessonTitle.toLowerCase()} com desafios reais das participantes.`,
            ),
            examples:
              Array.isArray(lessonRecord.examples) && lessonRecord.examples.length
                ? lessonRecord.examples.map(String)
                : ["Situação comum da rotina profissional", "Aplicação prática em contexto institucional"],
            reflection: stringValue(
              lessonRecord.reflection,
              "O que muda na sua prática quando este conceito é aplicado com intencionalidade?",
            ),
            exercise: stringValue(
              lessonRecord.exercise,
              "Registrar uma ação concreta para aplicar o aprendizado nos próximos dias.",
            ),
            opening: stringValue(lessonRecord.opening, "Vamos começar conectando este tema à experiência de vocês."),
            transition: stringValue(
              lessonRecord.transition,
              "Com essa base construída, podemos avançar para a próxima aplicação.",
            ),
            closing: stringValue(
              lessonRecord.closing,
              "Guarde a principal decisão desta aula e leve-a para a prática.",
            ),
          };
        }),
      };
    }),
  };
}

function completeMaterialsFromData(data: unknown, payload: Record<string, unknown>) {
  const generated = asRecord(data);
  const fallback = completeMaterials(payload);

  return {
    manual: normalizeItems(generated.manual, fallback.manual),
    slides: normalizeItems(generated.slides, fallback.slides),
    workbook: normalizeItems(generated.workbook, fallback.workbook),
    marketing: normalizeItems(generated.marketing, fallback.marketing),
    canva: {
      templateGuidance: normalizeStringArray(
        asRecord(generated.canva).templateGuidance,
        fallback.canva.templateGuidance,
      ),
    },
  };
}

function completeMaterials(payload: Record<string, unknown>) {
  const course = asRecord(payload.course);
  const source = normalizeSourceMaterial(payload.sourceMaterial);
  const matrix = completeMatrix(payload.matrix);
  const courseTitle = stringValue(course.title, "Curso da Universidade do Leste");
  const sourceMode = source.hasContent ? "com base no material existente" : "a partir do briefing inicial";

  const manual = [
    {
      title: "Abertura do curso",
      kind: "abertura",
      content: `Receba a turma com acolhimento, apresente o curso ${courseTitle} e explique que o percurso foi estruturado ${sourceMode}.`,
      facilitationNotes: [
        "Convide as participantes a compartilharem expectativas.",
        "Explique que o percurso combina conceitos, exemplos, reflexões e aplicação prática.",
      ],
      transitionPhrases: ["Vamos começar criando uma base comum para a aprendizagem."],
    },
    ...matrix.modules.flatMap((moduleItem, moduleIndex) => [
      {
        title: `Introdução do módulo ${moduleIndex + 1}: ${moduleItem.title}`,
        kind: "modulo",
        content: `${moduleItem.introduction} Objetivo do módulo: ${moduleItem.objective}`,
        facilitationNotes: ["Apresente o propósito do módulo antes de entrar nas aulas."],
        transitionPhrases: ["Com o objetivo claro, vamos para a primeira aula."],
      },
      ...moduleItem.lessons.map((lessonItem, lessonIndex) => ({
        title: `Aula ${moduleIndex + 1}.${lessonIndex + 1}: ${lessonItem.title}`,
        kind: "aula",
        content: `${lessonItem.opening} Desenvolva o tema com foco em ${lessonItem.objective} ${lessonItem.development}`,
        facilitationNotes: [
          `Exemplos sugeridos: ${lessonItem.examples.join("; ")}.`,
          `Reflexão: ${lessonItem.reflection}`,
          `Exercício: ${lessonItem.exercise}`,
        ],
        transitionPhrases: [lessonItem.transition, lessonItem.closing].filter(Boolean),
      })),
    ]),
    {
      title: "Encerramento do curso",
      kind: "encerramento",
      content:
        "Retome os principais aprendizados, convide cada participante a registrar um compromisso de aplicação e encerre com a presença institucional da Universidade do Leste.",
      facilitationNotes: ["Valorize a participação da turma e indique próximos passos."],
      transitionPhrases: ["A Universidade do Leste agradece sua participação neste percurso de aprendizagem."],
    },
  ];

  const slides = [
    {
      title: courseTitle,
      kicker: "Universidade do Leste",
      bullets: ["Boas-vindas", "Percurso 4 módulos", source.hasContent ? "Material original aprimorado" : "Aprendizagem prática"],
      speakerNotes: "Abra a apresentação com tom acolhedor e institucional.",
    },
    ...matrix.modules.flatMap((moduleItem, moduleIndex) => [
      {
        title: `Módulo ${moduleIndex + 1}`,
        kicker: moduleItem.title,
        bullets: [moduleItem.objective],
        speakerNotes: moduleItem.introduction,
      },
      ...moduleItem.lessons.map((lessonItem) => ({
        title: lessonItem.title,
        kicker: "Aula",
        bullets: [lessonItem.objective, lessonItem.reflection, lessonItem.exercise].filter(Boolean),
        speakerNotes: lessonItem.development,
      })),
    ]),
    {
      title: "Universidade do Leste",
      kicker: "Encerramento",
      bullets: ["Conhecimento aplicado", "Próximos passos", "Compromisso com a prática"],
      speakerNotes: "Finalize reforçando a presença institucional e o valor da continuidade.",
    },
  ];

  const workbook = [
    {
      title: "Boas-vindas",
      content: `Esta apostila acompanha o curso ${courseTitle} e foi preparada para apoiar sua participação ativa.`,
      activity: "Registre sua principal expectativa para o curso.",
      reflection: "Que resultado tornaria este curso valioso para você?",
      notesPrompt: "Minhas expectativas:",
    },
    ...matrix.modules.flatMap((moduleItem, moduleIndex) => [
      {
        title: `Módulo ${moduleIndex + 1}: ${moduleItem.title}`,
        content: `${moduleItem.introduction} Objetivo: ${moduleItem.objective}`,
        activity: "Anote uma situação real relacionada a este módulo.",
        reflection: "Qual conexão você faz com sua prática atual?",
        notesPrompt: "Anotações do módulo:",
      },
      ...moduleItem.lessons.map((lessonItem) => ({
        title: lessonItem.title,
        content: lessonItem.development,
        activity: lessonItem.exercise,
        reflection: lessonItem.reflection,
        notesPrompt: "Minhas anotações:",
      })),
    ]),
    {
      title: "Encerramento",
      content: "A Universidade do Leste agradece sua participação e incentiva a aplicação contínua do aprendizado.",
      activity: "Defina uma ação prática para executar nos próximos sete dias.",
      reflection: "Que compromisso você assume com seu desenvolvimento?",
      notesPrompt: "Meu plano de ação:",
    },
  ];

  const marketing = [
    {
      title: "Descrição curta do curso",
      content: `${courseTitle} é um curso da Universidade do Leste criado para apoiar aprendizagem prática, clareza de ação e desenvolvimento institucional.`,
      channels: ["Página do curso", "WhatsApp", "Instagram", "E-mail"],
      assets: ["Chamada curta", "Descrição institucional", "Benefícios", "Convite para inscrição"],
    },
    {
      title: "Chamada principal",
      content: `Aprenda, pratique e avance com o curso ${courseTitle}, uma experiência da Universidade do Leste.`,
      channels: ["Card de divulgação", "Mensagem curta"],
      assets: ["Título", "Subtítulo", "Chamada para ação"],
    },
  ];

  return {
    manual,
    slides,
    workbook,
    marketing,
    canva: {
      templateGuidance: [
        "Use a logo no início, no encerramento e nos materiais exportados.",
        "Reserve o dourado para chamadas, progresso e ações principais.",
        "Mantenha fundos claros para apostilas e azul profundo para aberturas.",
        "Crie peças de divulgação com benefício claro e presença institucional da Universidade do Leste.",
      ],
    },
  };
}

async function postCompletion(payload: unknown, config: DeepSeekConfig): Promise<CompletionResult> {
  try {
    const response = await fetchWithTimeout(
      `${config.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      config.timeoutMs,
    );

    const text = await response.text();
    const data = parseMaybeJson(text);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: deepSeekError(data) || `DeepSeek retornou HTTP ${response.status}.`,
      };
    }

    return { ok: true, data: data as CompletionResult["data"] };
  } catch (error) {
    return { ok: false, error: cleanError(error) };
  }
}

async function getDeepSeekModels(config: DeepSeekConfig) {
  try {
    const response = await fetchWithTimeout(
      `${config.baseUrl}/models`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
      },
      config.timeoutMs,
    );

    const text = await response.text();
    const data = parseMaybeJson(text);

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: deepSeekError(data) || `DeepSeek retornou HTTP ${response.status}.`,
      };
    }

    const records =
      data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)
        ? (data as { data: Array<{ id?: string }> }).data
        : [];
    const models = records.map((model) => model.id).filter(Boolean);

    return {
      ok: models.includes(config.model),
      status: response.status,
      models,
      error: models.includes(config.model)
        ? null
        : `O modelo ${config.model} não apareceu na lista de modelos da conta.`,
    };
  } catch (error) {
    return { ok: false, error: cleanError(error) };
  }
}

async function testPublicInternet(config: DeepSeekConfig) {
  try {
    const response = await fetchWithTimeout("https://example.com", { method: "GET" }, 12000);

    return {
      ok: response.ok,
      status: response.status,
      target: "https://example.com",
      error: response.ok ? null : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      target: "https://example.com",
      error: cleanError(error),
    };
  }
}

function getConfig(): DeepSeekConfig {
  return {
    apiKey: envValue("DEEPSEEK_API_KEY"),
    model: envValue("DEEPSEEK_MODEL") || "deepseek-v4-pro",
    baseUrl: (envValue("DEEPSEEK_BASE_URL") || "https://api.deepseek.com").replace(/\/+$/, ""),
    timeoutMs: Math.min(Number(envValue("DEEPSEEK_TIMEOUT_MS") || 24000), 24000),
  };
}

function envValue(key: string) {
  const netlifyEnv = typeof Netlify !== "undefined" && Netlify.env ? Netlify.env.get(key) : undefined;
  const processEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[key];

  return netlifyEnv || processEnv || "";
}

function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Tempo de conexão esgotado.")), timeoutMs);

  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));
}

function getDeepSeekHint(error?: string, status?: number, network?: { ok: boolean } | null) {
  const message = String(error || "").toLowerCase();

  if (network && !network.ok) {
    return "A Function da Netlify está sem saída HTTPS. Verifique status da Netlify ou tente novamente em alguns minutos.";
  }

  if (status === 401 || message.includes("invalid api key") || message.includes("authentication")) {
    return "Verifique se a chave da API está correta e ativa na plataforma da DeepSeek.";
  }

  if (status === 402 || message.includes("insufficient") || message.includes("balance") || message.includes("quota")) {
    return "Verifique saldo, cota ou limite de uso na conta DeepSeek.";
  }

  if (status === 404 || message.includes("model")) {
    return "Verifique se a conta tem acesso ao modelo configurado: deepseek-v4-pro.";
  }

  if (status === 429 || message.includes("rate limit")) {
    return "A conta atingiu limite de requisições. Aguarde um pouco e tente novamente.";
  }

  if (message.includes("fetch failed") || message.includes("timeout") || message.includes("econnreset")) {
    return "A conexão da Function com a DeepSeek falhou temporariamente.";
  }

  return "Abra o teste da IA no Leste Studio para ver o diagnóstico completo.";
}

function parseJsonContent(content: string) {
  const cleaned = String(content)
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`A IA respondeu fora do formato JSON esperado. ${cleanError(error)}`);
  }
}

function parseMaybeJson(text: string) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function deepSeekError(data: unknown) {
  if (!data || typeof data !== "object") return null;
  const error = (data as { error?: { message?: string; type?: string } }).error;
  return error && (error.message || error.type) ? error.message || error.type : null;
}

function normalizeSourceMaterial(value: unknown) {
  const source = asRecord(value);
  const text = stringValue(source.text).slice(0, 36000);

  return {
    hasContent: Boolean(source.hasContent || text),
    fileName: stringValue(source.fileName, "Material existente"),
    fileType: stringValue(source.fileType, "texto"),
    summary: stringValue(source.summary),
    analysis: asRecord(source.analysis),
    text,
  };
}

function normalizeItems(value: unknown, fallback: Array<Record<string, unknown>>) {
  return Array.isArray(value) && value.length ? value.map((item) => asRecord(item)) : fallback;
}

function normalizeStringArray(value: unknown, fallback: string[]) {
  return Array.isArray(value) && value.length ? value.map(String).filter(Boolean) : fallback;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
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
