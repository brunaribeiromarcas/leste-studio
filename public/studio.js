(function () {
  const STORAGE_KEY = "leste-studio-ai-v1";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = loadState();
  let toastTimer = null;

  init();

  function init() {
    bindEvents();
    renderCourse();
    renderMatrix();
    renderMaterials();
    checkAiHealth();
  }

  function defaultState() {
    return {
      activeTab: "manual",
      course: {
        title: "Gestão Estratégica para Mulheres Empreendedoras",
        audience: "Mulheres empreendedoras, líderes e gestoras em crescimento",
        duration: "8 aulas",
        modality: "Presencial",
        tone: "Acolhedor, profissional e institucional",
        goal:
          "Apoiar participantes na organização da estratégia, tomada de decisão e aplicação prática de ferramentas de gestão em seus negócios.",
        context:
          "Curso da Universidade do Leste, com foco em formação executiva feminina, aplicação prática, clareza pedagógica e identidade institucional.",
        source:
          "Planejamento, posicionamento, liderança, finanças, indicadores, comunicação, tomada de decisão e plano de ação.",
      },
      matrix: createEmptyMatrix(),
      materials: null,
      review: null,
      ai: {
        configured: false,
        provider: "DeepSeek",
        model: "deepseek-v4-flash",
      },
    };
  }

  function createEmptyMatrix() {
    return {
      modules: Array.from({ length: 4 }, (_, moduleIndex) => ({
        title: `Módulo ${moduleIndex + 1}`,
        objective: "",
        introduction: "",
        lessons: Array.from({ length: 2 }, (_, lessonIndex) => ({
          title: `Aula ${lessonIndex + 1}`,
          objective: "",
          development: "",
          examples: [],
          reflection: "",
          exercise: "",
          opening: "",
          transition: "",
          closing: "",
        })),
      })),
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return saved ? mergeState(defaultState(), saved) : defaultState();
    } catch {
      return defaultState();
    }
  }

  function mergeState(base, saved) {
    return {
      ...base,
      ...saved,
      course: { ...base.course, ...(saved.course || {}) },
      matrix: normalizeMatrix(saved.matrix || base.matrix),
      ai: { ...base.ai, ...(saved.ai || {}) },
    };
  }

  function saveState(showMessage = false) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (showMessage) showToast("Tudo salvo neste navegador.");
  }

  function bindEvents() {
    document.addEventListener("click", (event) => {
      const actionButton = event.target.closest("[data-action]");
      const tabButton = event.target.closest("[data-tab]");

      if (actionButton) {
        handleAction(actionButton.dataset.action, actionButton);
      }

      if (tabButton) {
        state.activeTab = tabButton.dataset.tab;
        saveState();
        renderMaterials();
      }
    });

    document.addEventListener("input", (event) => {
      const courseField = event.target.closest("[data-course]");
      const matrixField = event.target.closest("[data-matrix-path]");

      if (courseField) {
        state.course[courseField.dataset.course] = courseField.value;
        saveState();
      }

      if (matrixField) {
        setByPath(state.matrix, matrixField.dataset.matrixPath, matrixField.value);
        saveState();
      }
    });
  }

  async function handleAction(action, source) {
    const actionMap = {
      save: () => saveState(true),
      "fill-demo": fillDemo,
      "generate-matrix": () => generateMatrix(source),
      "generate-materials": () => generateMaterials(source),
      "review-materials": () => reviewMaterials(source),
      "test-ai": () => testAi(source),
      "download-json": downloadJson,
      "download-html": downloadHtml,
      "download-txt": downloadTxt,
      print: () => window.print(),
    };

    const handler = actionMap[action];
    if (handler) await handler();
  }

  async function checkAiHealth() {
    try {
      const response = await fetch("/api/health");
      const data = await response.json();
      state.ai = {
        configured: Boolean(data.configured),
        provider: data.provider || "DeepSeek",
        model: data.model || "deepseek-v4-flash",
        baseUrl: data.baseUrl || "",
      };
      updateAiCard(data.configured ? "ready" : "offline");
      saveState();
    } catch {
      updateAiCard("offline");
    }
  }

  function updateAiCard(status) {
    const card = $("[data-ai-card]");
    const title = $("[data-ai-title]");
    const subtitle = $("[data-ai-subtitle]");

    card.classList.toggle("is-ready", status === "ready");
    card.classList.toggle("is-offline", status === "offline");
    title.textContent = status === "ready" ? "IA ativa" : "IA indisponível";
    subtitle.textContent = `${state.ai.provider} / ${state.ai.model}`;
  }

  async function testAi(source) {
    await withLoading(source, async () => {
      try {
        const response = await fetch("/api/deepseek-test");
        const data = await response.json().catch(() => null);

        if (!response.ok || !data || !data.ok) {
          const message = (data && (data.hint || data.error)) || "Não foi possível conectar à DeepSeek.";
          updateAiCard("offline");
          showToast(`DeepSeek não conectou: ${message}`);
          return;
        }

        state.ai = {
          configured: true,
          provider: data.provider || "DeepSeek",
          model: data.model || "deepseek-v4-flash",
          baseUrl: data.baseUrl || "",
        };
        updateAiCard("ready");
        saveState();
        showToast("DeepSeek conectado e respondendo corretamente.");
      } catch (error) {
        updateAiCard("offline");
        showToast(`Falha no teste da IA: ${error.message}`);
      }
    });
  }

  function renderCourse() {
    $$("[data-course]").forEach((field) => {
      field.value = state.course[field.dataset.course] || "";
    });
  }

  function renderMatrix() {
    state.matrix = normalizeMatrix(state.matrix);
    const container = $("[data-matrix]");

    container.innerHTML = state.matrix.modules
      .map(
        (module, moduleIndex) => `
          <article class="module-card">
            <header>
              <span class="module-number">Módulo ${moduleIndex + 1}</span>
              <input data-matrix-path="modules.${moduleIndex}.title" value="${escapeAttribute(module.title)}" aria-label="Título do módulo ${moduleIndex + 1}" />
              <textarea data-matrix-path="modules.${moduleIndex}.objective" aria-label="Objetivo do módulo ${moduleIndex + 1}" placeholder="Objetivo do módulo">${escapeHtml(module.objective)}</textarea>
              <textarea data-matrix-path="modules.${moduleIndex}.introduction" aria-label="Introdução do módulo ${moduleIndex + 1}" placeholder="Introdução do módulo">${escapeHtml(module.introduction)}</textarea>
            </header>
            <div class="lesson-list">
              ${module.lessons
                .map(
                  (lesson, lessonIndex) => `
                    <div class="lesson-card">
                      <strong>Aula ${lessonIndex + 1}</strong>
                      <input data-matrix-path="modules.${moduleIndex}.lessons.${lessonIndex}.title" value="${escapeAttribute(lesson.title)}" aria-label="Título da aula ${lessonIndex + 1}" />
                      <textarea data-matrix-path="modules.${moduleIndex}.lessons.${lessonIndex}.objective" aria-label="Objetivo da aula ${lessonIndex + 1}" placeholder="Objetivo da aula">${escapeHtml(lesson.objective)}</textarea>
                      <textarea data-matrix-path="modules.${moduleIndex}.lessons.${lessonIndex}.exercise" aria-label="Exercício da aula ${lessonIndex + 1}" placeholder="Exercício prático">${escapeHtml(lesson.exercise)}</textarea>
                    </div>
                  `,
                )
                .join("")}
            </div>
          </article>
        `,
      )
      .join("");
  }

  function renderMaterials() {
    $$(".tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.tab === state.activeTab);
    });

    const output = $("[data-material-output]");
    const materials = state.materials;

    if (!materials && state.activeTab !== "review") {
      output.innerHTML = `<div class="empty-state">Gere os materiais para visualizar o conteúdo.</div>`;
      renderCanvaGuide();
      return;
    }

    if (state.activeTab === "manual") {
      output.innerHTML = renderSections(materials.manual || [], "content-card");
    }

    if (state.activeTab === "slides") {
      output.innerHTML = renderSlides(materials.slides || []);
    }

    if (state.activeTab === "workbook") {
      output.innerHTML = renderSections(materials.workbook || [], "content-card");
    }

    if (state.activeTab === "review") {
      output.innerHTML = renderReview();
    }

    renderCanvaGuide();
  }

  function renderSections(sections, className) {
    if (!sections.length) return `<div class="empty-state">Nenhum conteúdo disponível nesta aba.</div>`;

    return sections
      .map(
        (section) => `
          <article class="${className}">
            <h3>${escapeHtml(section.title || "Seção")}</h3>
            ${section.content ? `<p>${escapeHtml(section.content)}</p>` : ""}
            ${section.activity ? `<p><strong>Atividade:</strong> ${escapeHtml(section.activity)}</p>` : ""}
            ${section.reflection ? `<p><strong>Reflexão:</strong> ${escapeHtml(section.reflection)}</p>` : ""}
            ${section.notesPrompt ? `<p><strong>Anotações:</strong> ${escapeHtml(section.notesPrompt)}</p>` : ""}
            ${renderList(section.facilitationNotes, "Condução")}
            ${renderList(section.transitionPhrases, "Transições")}
          </article>
        `,
      )
      .join("");
  }

  function renderSlides(slides) {
    if (!slides.length) return `<div class="empty-state">Nenhum slide disponível.</div>`;

    return slides
      .map(
        (slide, index) => `
          <article class="content-card slide-card">
            <span class="slide-kicker">${escapeHtml(slide.kicker || `Slide ${index + 1}`)}</span>
            <h3>${escapeHtml(slide.title || `Slide ${index + 1}`)}</h3>
            ${renderList(slide.bullets)}
            ${slide.speakerNotes ? `<p><strong>Notas:</strong> ${escapeHtml(slide.speakerNotes)}</p>` : ""}
          </article>
        `,
      )
      .join("");
  }

  function renderReview() {
    if (!state.review) return `<div class="empty-state">Use a revisão com IA depois de gerar os materiais.</div>`;

    const review = state.review.review || state.review;
    return `
      <article class="content-card">
        <h3>Nota de qualidade: ${escapeHtml(String(review.score || "em análise"))}</h3>
        ${renderList(review.strengths, "Pontos fortes")}
        ${renderList(review.improvements, "Melhorias aplicadas")}
        ${renderList(review.risks, "Pontos de atenção")}
      </article>
    `;
  }

  function renderList(items, label = "") {
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return "";
    return `
      ${label ? `<p><strong>${escapeHtml(label)}:</strong></p>` : ""}
      <ul>${list.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("")}</ul>
    `;
  }

  function renderCanvaGuide() {
    const guide = $("[data-canva-guide]");
    const items = state.materials && state.materials.canva && state.materials.canva.templateGuidance;

    guide.innerHTML = (items && items.length
      ? items
      : [
          "Use a logo no início, no encerramento e nos materiais exportados.",
          "Reserve o dourado para chamadas, progresso e ações principais.",
          "Mantenha fundos claros para apostilas e azul profundo para aberturas.",
        ]
    )
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
  }

  async function generateMatrix(source) {
    await withLoading(source, async () => {
      try {
        const data = await callAi("matrix", { course: state.course });
        state.matrix = normalizeMatrix(data);
        state.materials = null;
        state.review = null;
        saveState();
        renderMatrix();
        renderMaterials();
        showToast("Matriz gerada com IA.");
      } catch (error) {
        state.matrix = makeLocalMatrix();
        saveState();
        renderMatrix();
        showToast(`Usei uma matriz local porque a IA não respondeu. ${error.message}`);
      }
    });
  }

  async function generateMaterials(source) {
    await withLoading(source, async () => {
      if (!hasMeaningfulMatrix()) {
        state.matrix = makeLocalMatrix();
        renderMatrix();
      }

      try {
        const data = await callAi("materials", {
          course: state.course,
          matrix: state.matrix,
        });
        state.materials = normalizeMaterials(data);
        state.review = null;
        saveState();
        renderMaterials();
        showToast("Materiais gerados com DeepSeek V4 Flash.");
      } catch (error) {
        state.materials = makeLocalMaterials();
        saveState();
        renderMaterials();
        showToast(`Usei geração local porque a IA não respondeu. ${error.message}`);
      }
    });
  }

  async function reviewMaterials(source) {
    if (!state.materials) {
      showToast("Gere os materiais antes da revisão.");
      return;
    }

    await withLoading(source, async () => {
      try {
        const data = await callAi("review", {
          course: state.course,
          materials: state.materials,
        });
        if (data.materials) state.materials = normalizeMaterials(data.materials);
        state.review = data.review ? data : { review: data };
        state.activeTab = "review";
        saveState();
        renderMaterials();
        showToast("Revisão concluída com IA.");
      } catch (error) {
        state.review = {
          review: {
            score: "pendente",
            strengths: ["Estrutura 4x2 preservada.", "Materiais organizados por finalidade."],
            improvements: ["Revisão com IA não foi concluída nesta tentativa."],
            risks: [error.message],
          },
        };
        state.activeTab = "review";
        saveState();
        renderMaterials();
        showToast("Não consegui revisar com IA agora.");
      }
    });
  }

  async function callAi(task, payload) {
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task, ...payload }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok || !result || !result.ok) {
      throw new Error((result && result.error) || "Falha na chamada da IA.");
    }

    return result.data;
  }

  function fillDemo() {
    state.matrix = makeLocalMatrix();
    state.materials = null;
    state.review = null;
    saveState();
    renderMatrix();
    renderMaterials();
    showToast("Exemplo aplicado à matriz.");
  }

  function makeLocalMatrix() {
    const themes = [
      ["Fundamentos estratégicos", "Diagnosticar o cenário atual e definir prioridades."],
      ["Cliente, valor e posicionamento", "Transformar clareza de público em proposta de valor."],
      ["Rotina de gestão e indicadores", "Organizar decisões com processos, números e acompanhamento."],
      ["Plano de ação e comunicação", "Converter aprendizado em execução consistente."],
    ];

    return {
      modules: themes.map(([title, objective], moduleIndex) => ({
        title,
        objective,
        introduction: `Neste módulo, a participante conecta ${title.toLowerCase()} à realidade do próprio negócio.`,
        lessons: [0, 1].map((lessonIndex) => ({
          title: lessonIndex === 0 ? `Compreender ${title.toLowerCase()}` : `Aplicar ${title.toLowerCase()}`,
          objective:
            lessonIndex === 0
              ? "Construir repertório e linguagem comum sobre o tema."
              : "Aplicar o conteúdo em uma decisão prática do negócio.",
          development:
            "A instrutora apresenta conceitos essenciais, exemplos reais e perguntas guiadas para conexão com a prática.",
          examples: ["Exemplo de negócio local", "Situação comum de tomada de decisão"],
          reflection: "O que precisa mudar na sua rotina para esse tema virar prática?",
          exercise: "Preencher um quadro de decisão com desafio, hipótese, ação e indicador.",
          opening: "Vamos começar conectando este tema à realidade de cada negócio.",
          transition: "Agora que temos clareza, vamos transformar a ideia em prática.",
          closing: "Fechamos esta aula com uma ação pequena, concreta e possível de executar.",
        })),
      })),
    };
  }

  function makeLocalMaterials() {
    const manual = [
      {
        title: `Abertura do curso: ${state.course.title}`,
        kind: "abertura",
        content:
          "Receba a turma com acolhimento, apresente a proposta do curso e conecte o percurso à realidade das participantes.",
        facilitationNotes: ["Convide cada participante a nomear um desafio atual.", "Reforce que o curso é prático e progressivo."],
        transitionPhrases: ["Com esse ponto de partida, vamos entrar na estrutura do percurso."],
      },
    ];

    const slides = [
      {
        title: state.course.title,
        kicker: "Universidade do Leste",
        bullets: ["Percurso em 4 módulos", "Aprendizagem prática", "Aplicação no negócio"],
        speakerNotes: "Apresente o curso como uma experiência de clareza, repertório e ação.",
      },
    ];

    const workbook = [
      {
        title: "Boas-vindas",
        content:
          "Esta apostila acompanha sua jornada de aprendizagem e foi criada para apoiar reflexão, organização e aplicação prática.",
        activity: "Escreva o principal desafio que você quer trabalhar ao longo do curso.",
        reflection: "Que resultado tornaria este curso valioso para você?",
        notesPrompt: "Minhas anotações iniciais",
      },
    ];

    state.matrix.modules.forEach((module, moduleIndex) => {
      manual.push({
        title: `Módulo ${moduleIndex + 1}: ${module.title}`,
        kind: "modulo",
        content: module.introduction || module.objective,
        facilitationNotes: [module.objective, "Conduza exemplos próximos à realidade das participantes."],
        transitionPhrases: ["Vamos avançar do entendimento para a aplicação."],
      });

      slides.push({
        title: module.title,
        kicker: `Módulo ${moduleIndex + 1}`,
        bullets: [module.objective || "Objetivo do módulo", "Conceitos essenciais", "Aplicação prática"],
        speakerNotes: module.introduction || "Contextualize o módulo antes de entrar nas aulas.",
      });

      workbook.push({
        title: `Módulo ${moduleIndex + 1}: ${module.title}`,
        content: module.introduction || module.objective,
        activity: "Registre uma aplicação prática deste módulo no seu negócio.",
        reflection: "Qual decisão fica mais clara depois deste módulo?",
        notesPrompt: "Anotações do módulo",
      });

      module.lessons.forEach((lesson, lessonIndex) => {
        manual.push({
          title: `Aula ${moduleIndex + 1}.${lessonIndex + 1}: ${lesson.title}`,
          kind: "aula",
          content: lesson.development || lesson.objective,
          facilitationNotes: [lesson.opening, lesson.exercise].filter(Boolean),
          transitionPhrases: [lesson.transition, lesson.closing].filter(Boolean),
        });

        slides.push({
          title: lesson.title,
          kicker: `Aula ${moduleIndex + 1}.${lessonIndex + 1}`,
          bullets: [lesson.objective, lesson.reflection, lesson.exercise].filter(Boolean),
          speakerNotes: lesson.development || lesson.opening,
        });

        workbook.push({
          title: `Atividade: ${lesson.title}`,
          content: lesson.objective,
          activity: lesson.exercise,
          reflection: lesson.reflection,
          notesPrompt: "Minhas anotações",
        });
      });
    });

    manual.push({
      title: "Encerramento institucional",
      kind: "encerramento",
      content:
        "Finalize retomando os avanços da turma e agradeça em nome da Universidade do Leste pelo compromisso com a aprendizagem e a prática.",
      facilitationNotes: ["Convide cada participante a declarar uma próxima ação."],
      transitionPhrases: ["A Universidade do Leste segue como parceira nessa jornada de desenvolvimento."],
    });

    slides.push({
      title: "Encerramento",
      kicker: "Universidade do Leste",
      bullets: ["Aprendizado aplicado", "Próxima ação definida", "Obrigada pela participação"],
      speakerNotes: "Finalize com acolhimento e orientação para continuidade.",
    });

    workbook.push({
      title: "Encerramento",
      content:
        "A Universidade do Leste agradece sua participação e incentiva a continuidade da aplicação prática no seu negócio.",
      activity: "Defina uma ação para executar nos próximos sete dias.",
      reflection: "Que compromisso você assume com seu próprio desenvolvimento?",
      notesPrompt: "Plano de continuidade",
    });

    return normalizeMaterials({
      manual,
      slides,
      workbook,
      canva: {
        templateGuidance: [
          "Crie capas com azul profundo, logo oficial e detalhe dourado.",
          "Use slides com um conceito central por tela.",
          "Monte a apostila em fundo claro, com espaços generosos para anotações.",
        ],
      },
    });
  }

  function normalizeMatrix(matrix) {
    const modules = Array.isArray(matrix.modules) ? matrix.modules.slice(0, 4) : [];

    while (modules.length < 4) {
      modules.push(createEmptyMatrix().modules[modules.length]);
    }

    return {
      modules: modules.map((module, moduleIndex) => {
        const lessons = Array.isArray(module.lessons) ? module.lessons.slice(0, 2) : [];
        while (lessons.length < 2) {
          lessons.push(createEmptyMatrix().modules[moduleIndex].lessons[lessons.length]);
        }

        return {
          title: module.title || `Módulo ${moduleIndex + 1}`,
          objective: module.objective || "",
          introduction: module.introduction || "",
          lessons: lessons.map((lesson, lessonIndex) => ({
            title: lesson.title || `Aula ${lessonIndex + 1}`,
            objective: lesson.objective || "",
            development: lesson.development || "",
            examples: Array.isArray(lesson.examples) ? lesson.examples : [],
            reflection: lesson.reflection || "",
            exercise: lesson.exercise || "",
            opening: lesson.opening || "",
            transition: lesson.transition || "",
            closing: lesson.closing || "",
          })),
        };
      }),
    };
  }

  function normalizeMaterials(materials) {
    return {
      manual: Array.isArray(materials.manual) ? materials.manual : [],
      slides: Array.isArray(materials.slides) ? materials.slides : [],
      workbook: Array.isArray(materials.workbook) ? materials.workbook : [],
      canva: materials.canva || { templateGuidance: [] },
    };
  }

  function hasMeaningfulMatrix() {
    return state.matrix.modules.some((module) => module.objective || module.lessons.some((lesson) => lesson.objective));
  }

  async function withLoading(source, callback) {
    const panel = source && source.closest(".panel");
    source && (source.disabled = true);
    panel && panel.classList.add("loading");

    try {
      await callback();
    } finally {
      source && (source.disabled = false);
      panel && panel.classList.remove("loading");
    }
  }

  function downloadJson() {
    downloadFile("leste-studio-materiais.json", JSON.stringify({ course: state.course, matrix: state.matrix, materials: state.materials }, null, 2), "application/json");
  }

  function downloadTxt() {
    downloadFile("leste-studio-materiais.txt", exportAsText(), "text/plain;charset=utf-8");
  }

  function downloadHtml() {
    downloadFile("leste-studio-materiais.html", exportAsHtml(), "text/html;charset=utf-8");
  }

  function exportAsText() {
    const lines = [`LESTE STUDIO`, `Curso: ${state.course.title}`, ""];
    const materials = state.materials || makeLocalMaterials();

    ["manual", "slides", "workbook"].forEach((key) => {
      lines.push(key.toUpperCase(), "");
      materials[key].forEach((item, index) => {
        lines.push(`${index + 1}. ${item.title || "Seção"}`);
        if (item.content) lines.push(item.content);
        if (item.bullets) item.bullets.forEach((bullet) => lines.push(`- ${bullet}`));
        if (item.activity) lines.push(`Atividade: ${item.activity}`);
        if (item.reflection) lines.push(`Reflexão: ${item.reflection}`);
        lines.push("");
      });
    });

    return lines.join("\n");
  }

  function exportAsHtml() {
    const materials = state.materials || makeLocalMaterials();
    return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(state.course.title)} | Leste Studio</title>
  <style>
    body { font-family: Arial, sans-serif; color: #172331; background: #F6FAFC; margin: 32px; line-height: 1.55; }
    h1, h2, h3 { color: #00385F; }
    section { margin: 0 0 28px; padding: 20px; background: #fff; border-left: 5px solid #F4C21F; }
    li { margin: 6px 0; }
  </style>
</head>
<body>
  <h1>${escapeHtml(state.course.title)}</h1>
  <p>Material gerado pelo Leste Studio, Universidade do Leste.</p>
  ${["manual", "slides", "workbook"]
    .map(
      (key) => `
        <h2>${key === "manual" ? "Manual da Instrutora" : key === "slides" ? "Slides" : "Apostila do Aluno"}</h2>
        ${materials[key]
          .map(
            (item) => `
              <section>
                <h3>${escapeHtml(item.title || "Seção")}</h3>
                ${item.content ? `<p>${escapeHtml(item.content)}</p>` : ""}
                ${item.bullets ? `<ul>${item.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>` : ""}
                ${item.activity ? `<p><strong>Atividade:</strong> ${escapeHtml(item.activity)}</p>` : ""}
                ${item.reflection ? `<p><strong>Reflexão:</strong> ${escapeHtml(item.reflection)}</p>` : ""}
              </section>
            `,
          )
          .join("")}
      `,
    )
    .join("")}
</body>
</html>`;
  }

  function downloadFile(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function setByPath(target, path, value) {
    const parts = path.split(".");
    let cursor = target;

    parts.slice(0, -1).forEach((part) => {
      cursor = cursor[Number.isNaN(Number(part)) ? part : Number(part)];
    });

    cursor[parts.at(-1)] = value;
  }

  function showToast(message) {
    const toast = $("[data-toast]");
    toast.textContent = message;
    toast.classList.add("is-visible");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 5200);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replaceAll("\n", " ");
  }
})();
