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
  const messages = buildMessages(task, body as Record<string, unknown>);

  if (!messages) {
    return jsonResponse(400, { ok: false, error: "Tarefa de geração inválida." });
  }

  const startedAt = Date.now();
  const completion = await callDeepSeek(messages, config);
  const parsed = parseJsonContent(completion.content);

  return jsonResponse(200, {
    ok: true,
    model: config.model,
    task,
    usage: completion.usage || null,
    elapsedMs: Date.now() - startedAt,
    data: parsed,
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
        { role: "user", content: 'Retorne {"ok":true,"mensagem":"DeepSeek conectado"}' },
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
  const matrix = asRecord(payload.matrix);
  const materials = asRecord(payload.materials);

  const baseContext = {
    nomeDoCurso: stringValue(course.title, "Curso sem título"),
    publico: stringValue(course.audience),
    objetivo: stringValue(course.goal),
    cargaHoraria: stringValue(course.duration),
    modalidade: stringValue(course.modality),
    tom: stringValue(course.tone, "acolhedor, profissional, claro e institucional"),
    contexto: stringValue(course.context),
    conteudosBase: stringValue(course.source),
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
    "Use princípios de design instrucional para adultos, clareza didática, progressão por objetivos, exemplos práticos e atividades aplicáveis.",
    "Responda exclusivamente com JSON válido, sem markdown, sem comentários fora do JSON e sem texto antes ou depois.",
    "Não invente promessas comerciais, certificações, leis, dados ou nomes de pessoas. Quando faltar informação, use formulações neutras e editáveis.",
  ].join(" ");

  if (task === "matrix") {
    return [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          tarefa: "Criar a matriz pedagógica completa do curso.",
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
                    examples: ["Exemplo prático 1", "Exemplo prático 2"],
                    reflection: "Pergunta reflexiva",
                    exercise: "Exercício prático",
                    opening: "Frase de abertura da aula",
                    transition: "Frase de transição para o próximo bloco",
                    closing: "Frase de encerramento da aula",
                  },
                ],
              },
            ],
          },
          regras: [
            "Criar exatamente 4 módulos.",
            "Cada módulo deve ter exatamente 2 aulas.",
            "As aulas devem evoluir de fundamentos para aplicação prática.",
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
          tarefa: "Gerar Manual da Instrutora, Slides e Apostila do Aluno a partir da matriz.",
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
            canva: {
              templateGuidance: ["Orientação para montar os materiais no Canva"],
            },
          },
          regras: [
            "O Manual deve orientar abertura, condução, desenvolvimento, exemplos, reflexões, exercícios, transições e encerramento.",
            "Os Slides devem ser visuais, objetivos e com pouco texto por slide.",
            "A Apostila deve conter boas-vindas, visão geral, resumos, exercícios, reflexões, atividades e espaços para anotações.",
            "Encerrar todos os materiais com menção institucional à Universidade do Leste.",
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
            "Não remover a estrutura 4x2 nem a menção institucional final.",
          ],
        }),
      },
    ];
  }

  return null;
}

async function callDeepSeek(messages: unknown[], config: DeepSeekConfig) {
  const payload = {
    model: config.model,
    messages,
    thinking: { type: "disabled" },
    temperature: 0.45,
    max_tokens: 8192,
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

    const records = data && typeof data === "object" && Array.isArray((data as { data?: unknown }).data)
      ? ((data as { data: Array<{ id?: string }> }).data)
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
    model: envValue("DEEPSEEK_MODEL") || "deepseek-v4-flash",
    baseUrl: (envValue("DEEPSEEK_BASE_URL") || "https://api.deepseek.com").replace(/\/+$/, ""),
    timeoutMs: Number(envValue("DEEPSEEK_TIMEOUT_MS") || 45000),
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
    return "Verifique se a conta tem acesso ao modelo configurado: deepseek-v4-flash.";
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value : fallback;
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
