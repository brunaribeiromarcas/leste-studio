(function () {
  const STORAGE_KEY = "leste-studio-ai-v2";
  const SOURCE_LIMIT = 22000;
  const SOURCE_STORE_LIMIT = 120000;
  const SERVER_UPLOAD_LIMIT_BYTES = 6 * 1024 * 1024;
  const LARGE_PDF_WARNING_BYTES = 15 * 1024 * 1024;
  const MAX_PDF_PAGES = 120;
  const OCR_PAGE_LIMIT = 12;
  const OCR_RENDER_SCALE = 1.75;
  const TESSERACT_SCRIPT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const state = loadState();
  let toastTimer = null;
  let selectedSourceFile = null;
  let pdfJsModulePromise = null;
  let tesseractLoadPromise = null;

  init();

  function init() {
    bindEvents();
    renderCourse();
    renderMode();
    renderMatrix();
    renderMaterials();
    checkAiHealth();
  }

  function defaultState() {
    return {
      mode: "scratch",
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
        pastedSource: "",
      },
      sourceMaterial: null,
      matrix: createEmptyMatrix(),
      materials: null,
      review: null,
      ai: {
        configured: false,
        provider: "DeepSeek",
        model: "deepseek-v4-pro",
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
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem("leste-studio-ai-v1"));
      return saved ? mergeState(defaultState(), saved) : defaultState();
    } catch {
      return defaultState();
    }
  }

  function mergeState(base, saved) {
    return {
      ...base,
      ...saved,
      mode: saved.mode === "transform" ? "transform" : "scratch",
      course: { ...base.course, ...(saved.course || {}) },
      sourceMaterial: saved.sourceMaterial || null,
      matrix: normalizeMatrix(saved.matrix || base.matrix),
      materials: saved.materials ? normalizeMaterials(saved.materials) : null,
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
      const modeButton = event.target.closest("[data-mode-choice]");

      if (modeButton) {
        setMode(modeButton.dataset.modeChoice);
      }

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
        if (courseField.dataset.course === "pastedSource" && courseField.value.trim()) {
          state.mode = "transform";
          state.sourceMaterial = makePastedSourceMaterial(courseField.value);
          renderMode();
        }
        saveState();
      }

      if (matrixField) {
        setByPath(state.matrix, matrixField.dataset.matrixPath, matrixField.value);
        saveState();
      }
    });

    const sourceInput = $("[data-source-file]");
    if (sourceInput) {
      sourceInput.addEventListener("change", () => {
        selectedSourceFile = sourceInput.files && sourceInput.files[0] ? sourceInput.files[0] : null;
        const label = $("[data-source-file-name]");
        if (label) label.textContent = selectedSourceFile ? selectedSourceFile.name : "PDF, DOCX ou PPTX";
        if (selectedSourceFile && isPdfFile(selectedSourceFile) && selectedSourceFile.size > LARGE_PDF_WARNING_BYTES) {
          showToast("PDF grande selecionado. A leitura será feita no navegador e pode levar alguns instantes.");
        }
        if (selectedSourceFile && !isPdfFile(selectedSourceFile) && selectedSourceFile.size > SERVER_UPLOAD_LIMIT_BYTES) {
          showToast("DOCX/PPTX acima de 6 MB não pode ser enviado ao servidor. Cole o conteúdo no campo de texto.");
        }
      });
    }
  }

  async function handleAction(action, source) {
    const actionMap = {
      save: () => saveState(true),
      "fill-demo": fillDemo,
      "generate-matrix": () => generateMatrix(source),
      "generate-materials": () => generateMaterials(source),
      "review-materials": () => reviewMaterials(source),
      "test-ai": () => testAi(source),
      "extract-file": () => extractSource(source),
      "clear-source": clearSource,
      "download-json": downloadJson,
      "download-html": downloadHtml,
      "download-txt": downloadTxt,
      "download-pdf": () => downloadProfessionalDocument("pdf", source),
      "download-docx": () => downloadProfessionalDocument("docx", source),
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
        model: data.model || "deepseek-v4-pro",
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

    if (!card || !title || !subtitle) return;
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
          model: data.model || "deepseek-v4-pro",
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

  function setMode(mode) {
    state.mode = mode === "transform" ? "transform" : "scratch";
    if (state.mode === "scratch" && !getSourceText()) {
      state.sourceMaterial = null;
    }
    saveState();
    renderMode();
  }

  function renderCourse() {
    $$("[data-course]").forEach((field) => {
      field.value = state.course[field.dataset.course] || "";
    });
  }

  function renderMode() {
    $$("[data-mode-choice]").forEach((button) => {
      const isActive = button.dataset.modeChoice === state.mode;
      button.classList.toggle("is-active", isActive);
      button.setAttribute("aria-checked", String(isActive));
    });

    const panel = $("[data-source-panel]");
    if (panel) panel.hidden = state.mode !== "transform";
    renderSourceSummary();
  }

  function renderSourceSummary() {
    const summary = $("[data-source-summary]");
    if (!summary) return;

    const source = effectiveSourceMaterial();
    if (!source || !source.text) {
      summary.innerHTML = `
        <strong>Nenhum material extraído ainda.</strong>
        <p>Ao enviar ou colar conteúdo, o Leste Studio preserva a base original e melhora estrutura, clareza, atividades e linguagem.</p>
      `;
      return;
    }

    const analysis = source.analysis || {};
    const weakPdf = isWeakSourceMaterial(source);
    summary.innerHTML = `
      <strong>${escapeHtml(source.fileName || "Conteúdo colado")} pronto para transformação</strong>
      <p>${escapeHtml(
        weakPdf
          ? "Atenção: o texto extraído parece conter só rodapé, marca d'água ou pouco conteúdo útil. Limpe o material e envie o PDF novamente para leitura por OCR, ou cole o conteúdo no campo de texto."
          : source.summary || "O conteúdo será usado como base principal para gerar os materiais faltantes.",
      )}</p>
      <dl>
        <dt>Origem</dt>
        <dd>${escapeHtml(source.fileType || "Texto colado")}</dd>
        <dt>Tamanho</dt>
        <dd>${Number(source.charCount || source.text.length).toLocaleString("pt-BR")} caracteres</dd>
        <dt>Leitura</dt>
        <dd>${escapeHtml(source.extractionMethod || "texto")}</dd>
        <dt>Indícios</dt>
        <dd>${escapeHtml(formatSourceSignals(analysis))}</dd>
      </dl>
    `;
  }

  function renderMatrix() {
    state.matrix = normalizeMatrix(state.matrix);
    const container = $("[data-matrix]");
    if (!container) return;

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
    if (!output) return;

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

    if (state.activeTab === "marketing") {
      output.innerHTML = renderSections(materials.marketing || [], "content-card marketing-card");
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
            ${renderList(section.channels, "Canais")}
            ${renderList(section.assets, "Peças sugeridas")}
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
    const list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!list.length) return "";
    return `
      ${label ? `<p><strong>${escapeHtml(label)}:</strong></p>` : ""}
      <ul>${list.map((item) => `<li>${escapeHtml(String(item))}</li>`).join("")}</ul>
    `;
  }

  function renderCanvaGuide() {
    const guide = $("[data-canva-guide]");
    if (!guide) return;
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

  async function extractSource(source) {
    await withLoading(source, async () => {
      if (selectedSourceFile) {
        if (isPdfFile(selectedSourceFile)) {
          if (selectedSourceFile.size > LARGE_PDF_WARNING_BYTES) {
            showToast("PDF grande detectado. Vou ler no navegador; pode levar alguns instantes.");
          } else {
            showToast("Lendo PDF no navegador.");
          }

          state.mode = "transform";
          state.sourceMaterial = await extractPdfInBrowser(selectedSourceFile);
          state.course.pastedSource = "";
          const pastedField = $('[data-course="pastedSource"]');
          if (pastedField) pastedField.value = "";
          selectedSourceFile = null;
          const sourceInput = $("[data-source-file]");
          if (sourceInput) sourceInput.value = "";
          const label = $("[data-source-file-name]");
          if (label) label.textContent = state.sourceMaterial.fileName || "PDF extraído";
          state.matrix = createEmptyMatrix();
          state.materials = null;
          state.review = null;
          saveState();
          renderMode();
          renderMatrix();
          renderMaterials();
          showToast(
            state.sourceMaterial.extractionMethod === "ocr"
              ? "PDF lido por OCR. Agora gere a matriz ou o pacote completo."
              : "PDF lido no navegador. Agora gere a matriz ou o pacote completo.",
          );
          return;
        }

        if (selectedSourceFile.size > SERVER_UPLOAD_LIMIT_BYTES) {
          throw new Error(
            "Este arquivo é grande demais para leitura pelo servidor. Para DOCX/PPTX, envie um arquivo de até 6 MB ou cole o conteúdo no campo de texto.",
          );
        }

        const formData = new FormData();
        formData.append("file", selectedSourceFile);

        const response = await fetch("/api/extract-material", {
          method: "POST",
          body: formData,
        });
        const result = await response.json().catch(() => null);

        if (!response.ok || !result || !result.ok) {
          throw new Error((result && result.error) || "Não foi possível extrair o arquivo.");
        }

        state.mode = "transform";
        state.sourceMaterial = normalizeSourceMaterial(result.data);
        state.course.pastedSource = "";
        const pastedField = $('[data-course="pastedSource"]');
        if (pastedField) pastedField.value = "";
        selectedSourceFile = null;
        const sourceInput = $("[data-source-file]");
        if (sourceInput) sourceInput.value = "";
        const label = $("[data-source-file-name]");
        if (label) label.textContent = state.sourceMaterial.fileName || "Material extraído";
        state.matrix = createEmptyMatrix();
        state.materials = null;
        state.review = null;
        saveState();
        renderMode();
        renderMatrix();
        renderMaterials();
        showToast("Material extraído. Agora gere a matriz ou o pacote completo.");
        return;
      }

      const pasted = String(state.course.pastedSource || "").trim();
      if (!pasted) {
        showToast("Envie um arquivo ou cole um conteúdo para transformar.");
        return;
      }

      state.mode = "transform";
      state.sourceMaterial = makePastedSourceMaterial(pasted);
      state.matrix = createEmptyMatrix();
      state.materials = null;
      state.review = null;
      saveState();
      renderMode();
      renderMatrix();
      renderMaterials();
      showToast("Texto colado preparado para transformação.");
    }, selectedSourceFile && isPdfFile(selectedSourceFile) ? "Lendo PDF..." : "Extraindo...").catch((error) => {
      showToast(error.message || "Não foi possível extrair o material.");
    });
  }

  function clearSource() {
    selectedSourceFile = null;
    state.sourceMaterial = null;
    state.course.pastedSource = "";
    if (state.mode === "transform") state.mode = "scratch";
    const sourceInput = $("[data-source-file]");
    if (sourceInput) sourceInput.value = "";
    const pastedField = $('[data-course="pastedSource"]');
    if (pastedField) pastedField.value = "";
    const label = $("[data-source-file-name]");
    if (label) label.textContent = "PDF, DOCX ou PPTX";
    saveState();
    renderMode();
    showToast("Material existente removido. O app voltou para criação do zero.");
  }

  function isPdfFile(file) {
    const name = String(file && file.name ? file.name : "").toLowerCase();
    const type = String(file && file.type ? file.type : "").toLowerCase();
    return name.endsWith(".pdf") || type.includes("pdf");
  }

  async function extractPdfInBrowser(file) {
    const pdfjs = await getPdfJs();
    pdfjs.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.mjs";

    const bytes = await file.arrayBuffer();
    const pdf = await pdfjs.getDocument({ data: bytes }).promise;
    const pageLimit = Math.min(pdf.numPages, MAX_PDF_PAGES);
    const chunks = [];
    let totalChars = 0;

    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => (item && typeof item.str === "string" ? item.str : ""))
        .filter(Boolean)
        .join(" ");

      if (pageText.trim()) {
        chunks.push(`Página ${pageNumber}\n${pageText}`);
        totalChars += pageText.length;
      }

      if (totalChars >= SOURCE_STORE_LIMIT) break;
    }

    const text = normalizeExtractedText(chunks.join("\n\n")).slice(0, SOURCE_STORE_LIMIT);

    if (isWeakPdfText(text)) {
      showToast("O PDF parece estar em imagem. Iniciando OCR; pode demorar alguns minutos.");
      const ocrText = await extractPdfWithOcr(pdf);

      if (!ocrText || isWeakPdfText(ocrText)) {
        throw new Error(
          "O PDF parece ser imagem ou escaneado e o OCR não conseguiu recuperar texto útil. Tente enviar uma versão DOCX/PPTX ou cole o conteúdo no campo de texto.",
        );
      }

      return normalizeSourceMaterial({
        fileName: file.name,
        fileType: "pdf",
        text: ocrText,
        charCount: ocrText.length,
        summary: firstSentence(ocrText) || "PDF lido por OCR e preparado para transformação pedagógica.",
        analysis: analyzeTextLocally(ocrText),
        extractionMethod: "ocr",
        truncated: pdf.numPages > OCR_PAGE_LIMIT || ocrText.length >= SOURCE_STORE_LIMIT,
        pageCount: pdf.numPages,
        pagesRead: Math.min(pdf.numPages, OCR_PAGE_LIMIT),
      });
    }

    return normalizeSourceMaterial({
      fileName: file.name,
      fileType: "pdf",
      text,
      charCount: text.length,
      summary: firstSentence(text) || "PDF lido no navegador e preparado para transformação pedagógica.",
      analysis: analyzeTextLocally(text),
      extractionMethod: "texto selecionável",
      truncated: pdf.numPages > pageLimit || text.length >= SOURCE_STORE_LIMIT,
      pageCount: pdf.numPages,
      pagesRead: pageLimit,
    });
  }

  async function extractPdfWithOcr(pdf) {
    const Tesseract = await getTesseract();
    const pagesToRead = Math.min(pdf.numPages, OCR_PAGE_LIMIT);
    const chunks = [];
    let totalChars = 0;
    let lastProgressToast = 0;

    for (let pageNumber = 1; pageNumber <= pagesToRead; pageNumber += 1) {
      showToast(`OCR do PDF: lendo página ${pageNumber} de ${pagesToRead}.`);
      const page = await pdf.getPage(pageNumber);
      const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });

      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);

      await page.render({ canvasContext: context, viewport }).promise;

      const result = await Tesseract.recognize(canvas, "por", {
        logger: (message) => {
          if (message.status !== "recognizing text") return;
          const now = Date.now();
          if (now - lastProgressToast < 3500) return;
          lastProgressToast = now;
          showToast(`OCR página ${pageNumber}/${pagesToRead}: ${Math.round((message.progress || 0) * 100)}%.`);
        },
      });

      const pageText = normalizeExtractedText(result && result.data ? result.data.text : "");
      if (pageText) {
        chunks.push(`Página ${pageNumber}\n${pageText}`);
        totalChars += pageText.length;
      }

      canvas.width = 1;
      canvas.height = 1;

      if (totalChars >= SOURCE_STORE_LIMIT) break;
    }

    return normalizeExtractedText(chunks.join("\n\n")).slice(0, SOURCE_STORE_LIMIT);
  }

  async function getTesseract() {
    if (window.Tesseract && window.Tesseract.recognize) return window.Tesseract;

    if (!tesseractLoadPromise) {
      tesseractLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = TESSERACT_SCRIPT_URL;
        script.async = true;
        script.onload = () => {
          if (window.Tesseract && window.Tesseract.recognize) {
            resolve(window.Tesseract);
          } else {
            reject(new Error("Tesseract.js carregou, mas não ficou disponível."));
          }
        };
        script.onerror = () => reject(new Error("Não foi possível carregar o OCR. Verifique a conexão e tente novamente."));
        document.head.appendChild(script);
      });
    }

    return tesseractLoadPromise;
  }

  function isWeakPdfText(text) {
    const normalized = normalizeExtractedText(text);
    if (normalized.length < 450) return true;

    const withoutHandles = normalized
      .replace(/@\w[\w.-]*/g, " ")
      .replace(/\bP[áa]gina\s+\d+\b/gi, " ")
      .replace(/\bSlide\s+\d+\b/gi, " ");
    const meaningfulWords = withoutHandles.match(/[A-Za-zÀ-ÿ]{4,}/g) || [];
    const uniqueWords = new Set(meaningfulWords.map((word) => word.toLowerCase()));
    const handleCount = (normalized.match(/@\w[\w.-]*/g) || []).length;

    return uniqueWords.size < 18 || (handleCount >= 4 && uniqueWords.size < 32);
  }

  async function getPdfJs() {
    if (window.lestePdfJs && window.lestePdfJs.getDocument) {
      return window.lestePdfJs;
    }

    if (!pdfJsModulePromise) {
      pdfJsModulePromise = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          import("./vendor/pdf.mjs").then(resolve).catch(reject);
        }, 1200);

        window.addEventListener(
          "leste:pdf-ready",
          () => {
            clearTimeout(timeout);
            resolve(window.lestePdfJs);
          },
          { once: true },
        );
      });
    }

    try {
      const pdfjs = await pdfJsModulePromise;
      if (!pdfjs || !pdfjs.getDocument) throw new Error("Módulo de PDF indisponível.");
      return pdfjs;
    } catch (error) {
      pdfJsModulePromise = null;
      throw new Error(`Não foi possível carregar o leitor de PDF. ${error.message || error}`);
    }
  }

  function normalizeExtractedText(text) {
    return String(text || "")
      .replace(/\r/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  async function generateMatrix(source) {
    await withLoading(source, async () => {
      if (shouldBlockWeakSource()) return;

      try {
        const data = await callAi("matrix", {
          course: state.course,
          mode: effectiveMode(),
          sourceMaterial: sourcePayload(),
        });
        state.matrix = normalizeMatrix(data);
        state.materials = null;
        state.review = null;
        saveState();
        renderMatrix();
        renderMaterials();
        showToast(hasExistingSource() ? "Matriz criada a partir do material existente." : "Matriz criada do zero com IA.");
      } catch (error) {
        if (hasExistingSource()) {
          showToast(`A IA não respondeu a tempo. Não gerei matriz local para evitar conteúdo incorreto. Tente novamente ou cole o texto principal do material. ${error.message}`);
          return;
        }

        state.matrix = makeLocalMatrix();
        saveState();
        renderMatrix();
        showToast(`Usei uma matriz local porque a IA não respondeu. ${error.message}`);
      }
    });
  }

  async function generateMaterials(source) {
    await withLoading(source, async () => {
      if (shouldBlockWeakSource()) return;

      if (!hasMeaningfulMatrix()) {
        try {
          const matrix = await callAi("matrix", {
            course: state.course,
            mode: effectiveMode(),
            sourceMaterial: sourcePayload(),
          });
          state.matrix = normalizeMatrix(matrix);
          renderMatrix();
        } catch {
          if (hasExistingSource()) {
            showToast("A IA não respondeu a tempo para criar a matriz a partir do material. Não gerei fallback para evitar conteúdo incorreto.");
            return;
          }
          state.matrix = makeLocalMatrix();
          renderMatrix();
        }
      }

      try {
        const data = await callAi("materials", {
          course: state.course,
          matrix: state.matrix,
          mode: effectiveMode(),
          sourceMaterial: sourcePayload(),
        });
        state.materials = normalizeMaterials(data);
        state.review = null;
        saveState();
        renderMaterials();
        showToast(hasExistingSource() ? "Pacote gerado preservando o material original." : "Pacote completo gerado do zero.");
      } catch (error) {
        if (hasExistingSource()) {
          showToast(`A IA não respondeu a tempo. Não gerei pacote local para evitar conteúdo incorreto. Tente novamente ou cole o texto principal do material. ${error.message}`);
          return;
        }

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
          mode: effectiveMode(),
          sourceMaterial: sourcePayload(),
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
      if (response.status === 504) {
        throw new Error("Timeout da IA no Netlify. A geração demorou mais que o limite do servidor.");
      }
      throw new Error((result && result.error) || `Falha na chamada da IA. HTTP ${response.status}`);
    }

    if (result.fallback && result.fallback.reason) {
      showToast(result.fallback.reason);
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
    const source = effectiveSourceMaterial();
    const titleHint = source && source.analysis && source.analysis.theme ? source.analysis.theme : "";
    const themes = hasExistingSource()
      ? [
          ["Organização do material original", "Identificar tema, público, conceitos centrais e lacunas do conteúdo recebido."],
          ["Fundamentos e conceitos principais", "Transformar os conceitos do material em explicações claras e aplicáveis."],
          ["Exemplos, práticas e atividades", "Converter exemplos e exercícios existentes em experiências de aprendizagem."],
          ["Síntese, aplicação e continuidade", "Consolidar o conteúdo em plano de ação e fechamento institucional."],
        ]
      : [
          ["Fundamentos estratégicos", "Diagnosticar o cenário atual e definir prioridades."],
          ["Cliente, valor e posicionamento", "Transformar clareza de público em proposta de valor."],
          ["Rotina de gestão e indicadores", "Organizar decisões com processos, números e acompanhamento."],
          ["Plano de ação e comunicação", "Converter aprendizado em execução consistente."],
        ];

    return {
      modules: themes.map(([title, objective], moduleIndex) => ({
        title: titleHint && moduleIndex === 0 ? `${title}: ${titleHint}` : title,
        objective,
        introduction: `Neste módulo, a participante conecta ${title.toLowerCase()} à realidade do próprio contexto.`,
        lessons: [0, 1].map((lessonIndex) => ({
          title: lessonIndex === 0 ? `Compreender ${title.toLowerCase()}` : `Aplicar ${title.toLowerCase()}`,
          objective:
            lessonIndex === 0
              ? "Construir repertório e linguagem comum sobre o tema."
              : "Aplicar o conteúdo em uma decisão prática.",
          development:
            "A instrutora apresenta conceitos essenciais, exemplos reais e perguntas guiadas para conexão com a prática.",
          examples: ["Exemplo de situação real", "Aplicação prática em contexto institucional"],
          reflection: "O que precisa mudar na sua rotina para esse tema virar prática?",
          exercise: "Preencher um quadro de decisão com desafio, hipótese, ação e indicador.",
          opening: "Vamos começar conectando este tema à realidade de cada participante.",
          transition: "Agora que temos clareza, vamos transformar a ideia em prática.",
          closing: "Fechamos esta aula com uma ação pequena, concreta e possível de executar.",
        })),
      })),
    };
  }

  function makeLocalMaterials() {
    const source = effectiveSourceMaterial();
    const modeLabel = hasExistingSource() ? "com base no material recebido" : "a partir do briefing";
    const manual = [
      {
        title: `Abertura do curso: ${state.course.title}`,
        kind: "abertura",
        content: `Receba a turma com acolhimento, apresente a proposta do curso e explique que o percurso foi estruturado ${modeLabel}.`,
        facilitationNotes: ["Convide cada participante a nomear um desafio atual.", "Reforce que o curso é prático e progressivo."],
        transitionPhrases: ["Com esse ponto de partida, vamos entrar na estrutura do percurso."],
      },
    ];

    const slides = [
      {
        title: state.course.title,
        kicker: "Universidade do Leste",
        bullets: ["Percurso em 4 módulos", "Aprendizagem prática", hasExistingSource() ? "Material original preservado e aprimorado" : "Curso criado do zero"],
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
        activity: "Registre uma aplicação prática deste módulo no seu contexto.",
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
        "A Universidade do Leste agradece sua participação e incentiva a continuidade da aplicação prática no seu contexto.",
      activity: "Defina uma ação para executar nos próximos sete dias.",
      reflection: "Que compromisso você assume com seu próprio desenvolvimento?",
      notesPrompt: "Plano de continuidade",
    });

    const marketing = [
      {
        title: "Resumo de divulgação",
        content: `${state.course.title} é um curso da Universidade do Leste estruturado para aprendizagem prática, linguagem acolhedora e aplicação imediata. ${source ? "O conteúdo original foi preservado e transformado em uma experiência pedagógica completa." : "O curso foi criado do zero com matriz 4x2 e materiais completos."}`,
        channels: ["Página do curso", "Mensagem de WhatsApp", "Post institucional"],
        assets: ["Chamada curta", "Descrição do curso", "Lista de benefícios", "Texto de convite"],
      },
      {
        title: "Chamada curta",
        content: `Participe do curso ${state.course.title} e avance com clareza, prática e apoio da Universidade do Leste.`,
      },
    ];

    return normalizeMaterials({
      manual,
      slides,
      workbook,
      marketing,
      canva: {
        templateGuidance: [
          "Crie capas com azul profundo, logo oficial e detalhe dourado.",
          "Use slides com um conceito central por tela.",
          "Monte a apostila em fundo claro, com espaços generosos para anotações.",
          "Prepare peças de divulgação com chamada curta, benefício principal e selo Universidade do Leste.",
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
      marketing: Array.isArray(materials.marketing) ? materials.marketing : [],
      canva: materials.canva || { templateGuidance: [] },
    };
  }

  function normalizeSourceMaterial(data) {
    const text = String(data && data.text ? data.text : "").slice(0, SOURCE_STORE_LIMIT);
    return {
      fileName: String((data && data.fileName) || "Material existente"),
      fileType: String((data && data.fileType) || "material"),
      text,
      summary: String((data && data.summary) || ""),
      analysis: (data && data.analysis) || analyzeTextLocally(text),
      extractionMethod: String((data && data.extractionMethod) || ""),
      charCount: Number((data && data.charCount) || text.length),
      extractedAt: new Date().toISOString(),
    };
  }

  function makePastedSourceMaterial(text) {
    const limitedText = String(text || "").slice(0, SOURCE_STORE_LIMIT);
    return {
      fileName: "Conteúdo colado",
      fileType: "texto",
      text: limitedText,
      summary: firstSentence(limitedText) || "Conteúdo colado preparado para transformação pedagógica.",
      analysis: analyzeTextLocally(limitedText),
      charCount: limitedText.length,
      extractedAt: new Date().toISOString(),
    };
  }

  function analyzeTextLocally(text) {
    const lines = String(text || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    const moduleCount = countMatches(text, /\bm[oó]dulo\b/gi);
    const lessonCount = countMatches(text, /\baula\b/gi);
    const activityCount = countMatches(text, /\b(atividade|exerc[ií]cio|pr[aá]tica)\b/gi);
    const exampleCount = countMatches(text, /\b(exemplo|caso|situa[cç][aã]o)\b/gi);
    return {
      theme: inferTheme(lines),
      moduleCount,
      lessonCount,
      activityCount,
      exampleCount,
      concepts: inferConcepts(text),
    };
  }

  function inferTheme(lines) {
    const candidate = lines.find((line) => line.length > 12 && line.length < 100);
    return candidate || state.course.title || "tema principal";
  }

  function inferConcepts(text) {
    return Array.from(
      new Set(
        String(text || "")
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .match(/\b[a-z]{5,}\b/g) || [],
      ),
    )
      .filter((word) => !["curso", "aula", "modulo", "sobre", "para", "como", "entre", "atividade", "material"].includes(word))
      .slice(0, 10);
  }

  function formatSourceSignals(analysis) {
    const parts = [];
    if (analysis.theme) parts.push(`tema: ${analysis.theme}`);
    if (analysis.moduleCount) parts.push(`${analysis.moduleCount} menções a módulo`);
    if (analysis.lessonCount) parts.push(`${analysis.lessonCount} menções a aula`);
    if (analysis.activityCount) parts.push(`${analysis.activityCount} atividades/exercícios`);
    if (analysis.exampleCount) parts.push(`${analysis.exampleCount} exemplos`);
    return parts.length ? parts.join("; ") : "estrutura será interpretada pela IA";
  }

  function countMatches(text, regex) {
    return (String(text || "").match(regex) || []).length;
  }

  function firstSentence(text) {
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim()
      .split(/(?<=[.!?])\s+/)[0]
      .slice(0, 240);
  }

  function effectiveMode() {
    return hasExistingSource() ? "transform" : "scratch";
  }

  function hasExistingSource() {
    return Boolean(getSourceText());
  }

  function shouldBlockWeakSource() {
    const source = effectiveSourceMaterial();
    if (!isWeakSourceMaterial(source)) return false;

    showToast(
      "O PDF extraído ainda não tem conteúdo útil, só rodapé/marca d'água. Clique em Limpar material, envie o PDF novamente e aguarde o OCR; ou cole o texto principal no campo ao lado.",
    );
    return true;
  }

  function isWeakSourceMaterial(source) {
    if (!source || !source.text) return false;
    const fileType = String(source.fileType || "").toLowerCase();
    const fileName = String(source.fileName || "").toLowerCase();

    return (fileType === "pdf" || fileName.endsWith(".pdf")) && isWeakPdfText(source.text);
  }

  function getSourceText() {
    const extracted = state.sourceMaterial && state.sourceMaterial.text ? state.sourceMaterial.text : "";
    const pasted = state.course && state.course.pastedSource ? state.course.pastedSource : "";
    return String(extracted || pasted || "").trim();
  }

  function effectiveSourceMaterial() {
    if (state.sourceMaterial && state.sourceMaterial.text) return state.sourceMaterial;
    const pasted = String(state.course.pastedSource || "").trim();
    return pasted ? makePastedSourceMaterial(pasted) : null;
  }

  function sourcePayload() {
    const source = effectiveSourceMaterial();
    if (!source || !source.text) {
      return {
        hasContent: false,
        instruction:
          "Não há material existente. Crie o curso do zero com profundidade pedagógica, matriz 4x2, linguagem acolhedora e identidade institucional.",
      };
    }

    return {
      hasContent: true,
      fileName: source.fileName,
      fileType: source.fileType,
      text: buildAiSourceText(source.text),
      analysis: source.analysis || analyzeTextLocally(source.text),
      instruction:
        "Há material existente. Preserve a intenção, os conceitos, exemplos e atividades originais sempre que forem úteis; reorganize, complete lacunas e melhore clareza, didática e padrão institucional.",
    };
  }

  function buildAiSourceText(text) {
    const normalized = normalizeExtractedText(text);
    if (normalized.length <= SOURCE_LIMIT) return normalized;

    const head = normalized.slice(0, Math.round(SOURCE_LIMIT * 0.62));
    const tail = normalized.slice(-Math.round(SOURCE_LIMIT * 0.22));
    const headings = normalized
      .split(/\n+/)
      .map((line) => line.trim())
      .filter((line) => line.length > 4 && line.length < 120)
      .filter((line) => /módulo|modulo|aula|tema|atividade|exercício|exercicio|capítulo|capitulo|parte|slide/i.test(line))
      .slice(0, 80)
      .join("\n");

    return normalizeExtractedText(
      [
        head,
        headings ? "\n\nTítulos e sinais estruturais encontrados:\n" + headings : "",
        "\n\nTrecho final do material:\n" + tail,
      ].join(""),
    ).slice(0, SOURCE_LIMIT);
  }

  function hasMeaningfulMatrix() {
    return state.matrix.modules.some((module) => module.objective || module.lessons.some((lesson) => lesson.objective));
  }

  async function withLoading(source, callback, loadingLabel = "Processando...") {
    const panel = source && source.closest(".panel");
    const originalText = source ? source.textContent : "";
    if (source) source.disabled = true;
    if (source && source.tagName === "BUTTON") source.textContent = loadingLabel;
    if (panel) panel.classList.add("loading");

    try {
      await callback();
    } finally {
      if (source) source.disabled = false;
      if (source && source.tagName === "BUTTON") source.textContent = originalText;
      if (panel) panel.classList.remove("loading");
    }
  }

  function downloadJson() {
    downloadFile(
      "leste-studio-materiais.json",
      JSON.stringify(
        {
          mode: effectiveMode(),
          course: state.course,
          sourceMaterial: effectiveSourceMaterial(),
          matrix: state.matrix,
          materials: state.materials,
        },
        null,
        2,
      ),
      "application/json",
    );
  }

  function downloadTxt() {
    downloadFile("leste-studio-materiais.txt", exportAsText(), "text/plain;charset=utf-8");
  }

  function downloadHtml() {
    downloadFile("leste-studio-materiais.html", exportAsHtml(), "text/html;charset=utf-8");
  }

  async function downloadProfessionalDocument(format, source) {
    if (!state.materials) {
      state.materials = makeLocalMaterials();
      saveState();
      renderMaterials();
    }

    await withLoading(source, async () => {
      const response = await fetch("/api/export-document", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          format,
          mode: effectiveMode(),
          course: state.course,
          sourceMaterial: effectiveSourceMaterial(),
          matrix: state.matrix,
          materials: state.materials,
        }),
      });

      if (!response.ok) {
        const result = await response.json().catch(() => null);
        throw new Error((result && result.error) || "Não foi possível exportar o documento.");
      }

      const blob = await response.blob();
      const filename = filenameFromResponse(response) || `leste-studio-materiais.${format}`;
      downloadBlob(filename, blob);
      showToast(format === "pdf" ? "PDF profissional gerado." : "DOCX editável gerado.");
    }).catch((error) => {
      showToast(error.message || "Não foi possível exportar o documento.");
    });
  }

  function exportAsText() {
    const lines = [`LESTE STUDIO`, `Modo: ${effectiveMode() === "transform" ? "Transformar material existente" : "Criar curso do zero"}`, `Curso: ${state.course.title}`, ""];
    const materials = state.materials || makeLocalMaterials();

    [
      ["manual", "MANUAL DA INSTRUTORA"],
      ["slides", "SLIDES"],
      ["workbook", "APOSTILA DO ALUNO"],
      ["marketing", "MATERIAIS DE DIVULGAÇÃO"],
    ].forEach(([key, label]) => {
      lines.push(label, "");
      (materials[key] || []).forEach((item, index) => {
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
  ${[
    ["manual", "Manual da Instrutora"],
    ["slides", "Slides"],
    ["workbook", "Apostila do Aluno"],
    ["marketing", "Materiais de Divulgação"],
  ]
    .map(
      ([key, label]) => `
        <h2>${label}</h2>
        ${(materials[key] || [])
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
    downloadBlob(filename, blob);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function filenameFromResponse(response) {
    const disposition = response.headers.get("Content-Disposition") || "";
    const match = disposition.match(/filename="([^"]+)"/i) || disposition.match(/filename=([^;]+)/i);

    return match ? match[1].trim() : "";
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
    if (!toast) return;
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
