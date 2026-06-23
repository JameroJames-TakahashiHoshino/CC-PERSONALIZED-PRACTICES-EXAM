if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';
    }

const state = {
      bank: null,
      currentDomainId: null,
      currentQuestionIndex: 0,
      answers: new Map(),
      flagged: new Set(),
      configuredDurationSeconds: 120 * 60,
      timerDurationSeconds: 120 * 60,
      remainingSeconds: 120 * 60,
      timerHandle: null,
      examStartedAt: null,
      examSubmittedAt: null,
      reviewFilter: 'all',
      activeQuestions: []
    };

    const refs = {
      fileInput: document.getElementById('fileInput'),
      uploadZone: document.getElementById('uploadZone'),
      autoLoadBtn: document.getElementById('autoLoadBtn'),
      startBtn: document.getElementById('startBtn'),
      domainSelect: document.getElementById('domainSelect'),
      durationInput: document.getElementById('durationInput'),
      bankStatus: document.getElementById('bankStatus'),
      bankOverview: document.getElementById('bankOverview'),
      domainCards: document.getElementById('domainCards'),
      loadedQuestions: document.getElementById('loadedQuestions'),
      currentDomainLabel: document.getElementById('currentDomainLabel'),
      answeredCount: document.getElementById('answeredCount'),
      timerDisplay: document.getElementById('timerDisplay'),
      statTimer: document.getElementById('statTimer'),
      examArea: document.getElementById('examArea'),
      resultsArea: document.getElementById('resultsArea'),
      questionCounter: document.getElementById('questionCounter'),
      questionTotal: document.getElementById('questionTotal'),
      markedCount: document.getElementById('markedCount'),
      progressText: document.getElementById('progressText'),
      progressFill: document.getElementById('progressFill'),
      domainHeading: document.getElementById('domainHeading'),
      questionTitle: document.getElementById('questionTitle'),
      emptyQuestionState: document.getElementById('emptyQuestionState'),
      questionBody: document.getElementById('questionBody'),
      questionText: document.getElementById('questionText'),
      optionsList: document.getElementById('optionsList'),
      navigator: document.getElementById('navigator'),
      prevBtn: document.getElementById('prevBtn'),
      nextBtn: document.getElementById('nextBtn'),
      markBtn: document.getElementById('markBtn'),
      clearBtn: document.getElementById('clearBtn'),
      submitBtn: document.getElementById('submitBtn'),
      localAnswered: document.getElementById('localAnswered'),
      inlineTimer: document.getElementById('inlineTimer'),
      resultDomain: document.getElementById('resultDomain'),
      scoreValue: document.getElementById('scoreValue'),
      correctValue: document.getElementById('correctValue'),
      wrongValue: document.getElementById('wrongValue'),
      timeUsedValue: document.getElementById('timeUsedValue'),
      resultSummary: document.getElementById('resultSummary'),
      resultAnswered: document.getElementById('resultAnswered'),
      resultFlagged: document.getElementById('resultFlagged'),
      resultUnanswered: document.getElementById('resultUnanswered'),
      reviewList: document.getElementById('reviewList'),
      reviewAllBtn: document.getElementById('reviewAllBtn'),
      reviewWrongBtn: document.getElementById('reviewWrongBtn'),
      retakeBtn: document.getElementById('retakeBtn'),
      examStartOverlay: document.getElementById('examStartOverlay'),
      examStartScrollBtn: document.getElementById('examStartScrollBtn'),
      examStartDismissBtn: document.getElementById('examStartDismissBtn'),
    };

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
    }

    function formatDuration(seconds) {
      const safe = Math.max(0, Math.floor(seconds));
      const hours = String(Math.floor(safe / 3600)).padStart(2, '0');
      const minutes = String(Math.floor((safe % 3600) / 60)).padStart(2, '0');
      const secs = String(safe % 60).padStart(2, '0');
      return `${hours}:${minutes}:${secs}`;
    }

    function clamp(value, min, max) {
      return Math.min(max, Math.max(min, value));
    }

    function firstNonEmpty(...values) {
      for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim()) {
          return value;
        }
      }
      return '';
    }

    function stripMarkdown(value) {
      return String(value)
        .replace(/\*\*/g, '')
        .replace(/__/g, '')
        .replace(/`/g, '')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    function normalizeChoiceLetter(value, fallbackLetter) {
      const letter = String(firstNonEmpty(value, fallbackLetter)).trim().toUpperCase();
      return /^[A-D]$/.test(letter) ? letter : '';
    }

    function normalizeOptionsSource(source) {
      if (!source) return [];

      if (Array.isArray(source)) {
        return source.map((option, index) => {
          if (typeof option === 'string') {
            return { letter: String.fromCharCode(65 + index), text: option.trim() };
          }

          if (option && typeof option === 'object') {
            const letter = normalizeChoiceLetter(
              firstNonEmpty(option.letter, option.key, option.id, option.label, option.choice, option.option),
              String.fromCharCode(65 + index)
            );
            const text = stripMarkdown(firstNonEmpty(option.text, option.value, option.answer, option.content, option.body, option.label));
            if (letter && text) {
              return { letter, text };
            }
          }

          return null;
        }).filter(Boolean);
      }

      if (typeof source === 'object') {
        return Object.entries(source).map(([key, value]) => {
          const letter = normalizeChoiceLetter(key);
          const text = stripMarkdown(value);
          return letter && text ? { letter, text } : null;
        }).filter(Boolean);
      }

      return [];
    }

    function normalizeAnswerValue(value, options = []) {
      if (value && typeof value === 'object') {
        const letter = normalizeChoiceLetter(firstNonEmpty(value.letter, value.key, value.choice, value.answer));
        if (letter) {
          return { letter, answerText: stripMarkdown(firstNonEmpty(value.answerText, value.text, value.value, value.label, options.find((option) => option.letter === letter)?.text || '')), why: stripMarkdown(firstNonEmpty(value.why, value.explanation, value.reason, value.rationale)) };
        }
      }

      if (typeof value === 'string' || typeof value === 'number') {
        const text = String(value).trim();
        const letterMatch = text.match(/\b([A-D])\b/i);
        const letter = normalizeChoiceLetter(letterMatch?.[1] || text);
        if (letter) {
          return { letter, answerText: options.find((option) => option.letter === letter)?.text || '', why: '' };
        }
      }

      return null;
    }

    function normalizeQuestionRecord(record, fallbackNumber) {
      if (!record || typeof record !== 'object' || Array.isArray(record)) {
        return null;
      }

      const prompt = stripMarkdown(firstNonEmpty(record.prompt, record.question, record.text, record.title, record.body, record.q, record.stem));
      const options = normalizeOptionsSource(firstNonEmpty(record.options, record.choices, record.answers, record.alternatives, record.variants));
      const answer = normalizeAnswerValue(firstNonEmpty(record.answer, record.correct, record.correctAnswer, record.key, record.ans, record.response), options);
      const questionNumber = Number(firstNonEmpty(record.number, record.no, record.id, fallbackNumber));
      if (!prompt || !options.length || !Number.isFinite(questionNumber)) {
        return null;
      }

      return {
        number: questionNumber,
        prompt,
        options,
        answer: answer || null
      };
    }

    function parseRecordsAsBank(records, defaultDomainName = 'Imported bank') {
      if (!Array.isArray(records) || !records.length) return [];

      const questionBucket = [];
      const domainBucket = new Map();

      records.forEach((record, index) => {
        const normalized = normalizeQuestionRecord(record, index + 1);
        if (!normalized) {
          return;
        }

        const domainId = Number(firstNonEmpty(record.domainId, record.domain, record.sectionId, 1)) || 1;
        const domainName = stripMarkdown(firstNonEmpty(record.domainName, record.domainTitle, record.section, defaultDomainName));
        const existing = domainBucket.get(domainId) || { id: domainId, name: domainName, questions: [] };
        existing.questions.push(normalized);
        domainBucket.set(domainId, existing);
        questionBucket.push(normalized);
      });

      if (domainBucket.size) {
        return [...domainBucket.values()].sort((a, b) => a.id - b.id).map((domain) => ({
          ...domain,
          questions: domain.questions.sort((a, b) => a.number - b.number)
        }));
      }

      if (questionBucket.length) {
        return [{ id: 1, name: defaultDomainName, questions: questionBucket.sort((a, b) => a.number - b.number) }];
      }

      return [];
    }

    function parseJsonBank(data, defaultDomainName = 'Imported bank') {
      if (!data || typeof data !== 'object') return [];

      if (Array.isArray(data)) {
        return parseRecordsAsBank(data, defaultDomainName);
      }

      if (Array.isArray(data.domains)) {
        const domains = data.domains.map((domain, index) => {
          const id = Number(firstNonEmpty(domain.id, domain.domainId, index + 1)) || index + 1;
          const name = stripMarkdown(firstNonEmpty(domain.name, domain.title, domain.domainName, `Domain ${id}`));
          const questions = Array.isArray(domain.questions) ? domain.questions.map((question, questionIndex) => {
            const normalized = normalizeQuestionRecord({
              ...question,
              domainId: id,
              domainName: name
            }, questionIndex + 1);
            return normalized;
          }).filter(Boolean) : [];

          return questions.length ? { id, name, questions } : null;
        }).filter(Boolean);

        if (domains.length) {
          return domains.sort((a, b) => a.id - b.id);
        }
      }

      if (Array.isArray(data.questions)) {
        return parseRecordsAsBank(data.questions, firstNonEmpty(data.name, data.title, defaultDomainName));
      }

      if (data.question || data.prompt || data.options || data.choices) {
        const question = normalizeQuestionRecord(data, 1);
        if (question) {
          return [{ id: 1, name: firstNonEmpty(data.name, data.title, defaultDomainName), questions: [question] }];
        }
      }

      return [];
    }

    function extractAnswerMapFromText(text) {
      const answerMap = new Map();
      const tableRows = [...text.matchAll(/^\|\s*(\d+)\s*\|\s*([A-D])\s*\|.*$/gim)];
      for (const row of tableRows) {
        answerMap.set(Number(row[1]), row[2].toUpperCase());
      }

      const simpleRows = [...text.matchAll(/^\s*(\d+)\s*[\).:\-]\s*([A-D])\b/gim)];
      for (const row of simpleRows) {
        if (!answerMap.has(Number(row[1]))) {
          answerMap.set(Number(row[1]), row[2].toUpperCase());
        }
      }

      const inlineRows = [...text.matchAll(/^\s*(?:answer|ans|correct(?: answer)?|key)\s*[:\-]\s*(?:question\s*)?(\d+)?\s*([A-D])\b/gim)];
      for (const row of inlineRows) {
        if (row[1]) {
          answerMap.set(Number(row[1]), row[2].toUpperCase());
        }
      }

      return answerMap;
    }

    function parseLooseTextBank(text, defaultDomainName = 'Imported bank') {
      const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      const lines = normalized.split('\n');
      const questionStart = /^\s*(?:\*\*)?\s*(?:q(?:uestion)?\s*)?(\d+)\s*[\).:\-]\s*(.+?)(?:\*\*)?\s*$/i;
      const optionLine = /^\s*([A-D])\s*[\).]\s*(.+?)\s*$/i;
      const answerHeading = /^\s*(?:#{1,6}\s*)?answer key\b/i;
      const answerLine = /^\s*(?:answer|ans|correct(?: answer)?|key)\s*[:\-]\s*([A-D])\b/i;

      const answerMap = extractAnswerMapFromText(normalized);
      const questions = [];
      let current = null;
      let inAnswerKey = false;

      const pushCurrent = () => {
        if (!current) return;
        const prompt = stripMarkdown(current.promptLines.join(' ').trim());
        const options = current.options.filter(Boolean);
        const answerLetter = normalizeChoiceLetter(current.answerLetter || answerMap.get(current.number));
        const answer = answerLetter ? {
          letter: answerLetter,
          answerText: options.find((option) => option.letter === answerLetter)?.text || '',
          why: current.why || ''
        } : null;

        if (prompt && options.length) {
          questions.push({
            number: current.number,
            prompt,
            options,
            answer
          });
        }

        current = null;
      };

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          if (current && !current.options.length) {
            current.promptLines.push('');
          }
          continue;
        }

        if (answerHeading.test(trimmed)) {
          inAnswerKey = true;
          pushCurrent();
          continue;
        }

        if (inAnswerKey) {
          const tableRow = trimmed.match(/^\|\s*(\d+)\s*\|\s*([A-D])\s*\|/i);
          if (tableRow) {
            answerMap.set(Number(tableRow[1]), tableRow[2].toUpperCase());
            continue;
          }

          const numberedRow = trimmed.match(/^\s*(\d+)\s*[\).:\-]\s*([A-D])\b/i);
          if (numberedRow) {
            answerMap.set(Number(numberedRow[1]), numberedRow[2].toUpperCase());
            continue;
          }

          const inlineRow = trimmed.match(answerLine);
          if (inlineRow && current) {
            current.answerLetter = inlineRow[1].toUpperCase();
          }
          continue;
        }

        const questionMatch = trimmed.match(questionStart);
        if (questionMatch) {
          pushCurrent();
          current = {
            number: Number(questionMatch[1]),
            promptLines: [stripMarkdown(questionMatch[2])],
            options: [],
            answerLetter: answerMap.get(Number(questionMatch[1])) || '',
            why: ''
          };
          continue;
        }

        if (!current) {
          continue;
        }

        const optionMatch = trimmed.match(optionLine);
        if (optionMatch) {
          current.options.push({ letter: optionMatch[1].toUpperCase(), text: stripMarkdown(optionMatch[2]) });
          continue;
        }

        const inlineAnswerMatch = trimmed.match(answerLine);
        if (inlineAnswerMatch) {
          current.answerLetter = inlineAnswerMatch[1].toUpperCase();
          continue;
        }

        const whyMatch = trimmed.match(/^\s*(?:why|explanation|reason)\s*[:\-]\s*(.+)$/i);
        if (whyMatch) {
          current.why = stripMarkdown(whyMatch[1]);
          continue;
        }

        if (!/^\s*[A-D]\s*[\).]/i.test(trimmed)) {
          current.promptLines.push(trimmed);
        }
      }

      pushCurrent();

      if (!questions.length) {
        return [];
      }

      return [{
        id: 1,
        name: defaultDomainName,
        questions: questions.sort((a, b) => a.number - b.number)
      }];
    }

    function parseImportedContent(payload, defaultDomainName = 'Imported bank') {
      if (!payload) return [];

      if (payload.kind === 'json') {
        return parseJsonBank(payload.data, defaultDomainName);
      }

      if (payload.kind === 'records') {
        return parseRecordsAsBank(payload.records, defaultDomainName);
      }

      if (payload.kind === 'text') {
        const trimmed = payload.text.trim();
        if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
          try {
            const json = JSON.parse(trimmed);
            const bank = parseJsonBank(json, defaultDomainName);
            if (bank.length) {
              return bank;
            }
          } catch (error) {
            // Fall through to text parsing.
          }
        }

        const structuredBank = parseBank(trimmed);
        if (structuredBank.length) {
          return structuredBank;
        }

        return parseLooseTextBank(trimmed, defaultDomainName);
      }

      return [];
    }

    async function extractTextFromPdf(arrayBuffer) {
      if (!window.pdfjsLib) {
        throw new Error('PDF support is unavailable in this browser.');
      }

      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      const pages = [];
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items.map((item) => item.str || '').join(' ');
        pages.push(pageText);
      }
      return pages.join('\n\n');
    }

    async function extractPayloadFromFile(file) {
      const extension = (file.name.split('.').pop() || '').toLowerCase();
      const mimeType = (file.type || '').toLowerCase();
      const isTextLike = [
        'txt', 'md', 'markdown', 'csv', 'json', 'html', 'htm', 'xml', 'rtf'
      ].includes(extension) || mimeType.startsWith('text/') || mimeType.includes('json');

      if (isTextLike) {
        return { kind: 'text', text: await file.text() };
      }

      const buffer = await file.arrayBuffer();

      if (extension === 'pdf' || mimeType === 'application/pdf') {
        return { kind: 'text', text: await extractTextFromPdf(buffer) };
      }

      if (extension === 'docx' || mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        if (!window.mammoth) {
          throw new Error('Word document support is unavailable in this browser.');
        }

        const result = await window.mammoth.extractRawText({ arrayBuffer: buffer });
        return { kind: 'text', text: result.value || '' };
      }

      if (extension === 'xlsx' || extension === 'xls' || mimeType.includes('spreadsheetml')) {
        if (!window.XLSX) {
          throw new Error('Excel support is unavailable in this browser.');
        }

        const workbook = window.XLSX.read(buffer, { type: 'array' });
        const records = [];

        workbook.SheetNames.forEach((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const sheetRecords = window.XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
          sheetRecords.forEach((record) => {
            records.push({
              ...record,
              sheetName
            });
          });
        });

        if (records.length) {
          return { kind: 'records', records };
        }

        return { kind: 'text', text: workbook.SheetNames.map((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          const csv = window.XLSX.utils.sheet_to_csv(sheet);
          return csv ? `## Sheet: ${sheetName}\n${csv}` : '';
        }).filter(Boolean).join('\n\n') };
      }

      return { kind: 'text', text: await file.text() };
    }

    function parseBank(text) {
      const domainMatches = [...text.matchAll(/^#\s+Domain\s+(\d+)\s+[—-]\s+(.+)$/gm)];
      const domains = [];

      for (let index = 0; index < domainMatches.length; index += 1) {
        const match = domainMatches[index];
        const domainId = Number(match[1]);
        const domainName = match[2].trim();
        const start = match.index + match[0].length;
        const nextStart = index + 1 < domainMatches.length ? domainMatches[index + 1].index : text.length;
        const section = text.slice(start, nextStart);
        const answerKeyMatch = section.match(new RegExp(`##\\s+Answer Key\\s+[—-]\\s+Domain\\s+${domainId}(?:\\s+[—-]\\s+.+)?`, 'm'));
        const answerKeyIndex = answerKeyMatch ? answerKeyMatch.index : -1;
        if (answerKeyIndex === -1) {
          continue;
        }

        const questionsSection = section.slice(0, answerKeyIndex);
        const answerSection = section.slice(answerKeyIndex);
        const questionHeaders = [...questionsSection.matchAll(/\*\*(\d+)\.\s*([\s\S]*?)\*\*/g)];
        const questions = [];

        for (let qIndex = 0; qIndex < questionHeaders.length; qIndex += 1) {
          const qMatch = questionHeaders[qIndex];
          const number = Number(qMatch[1]);
          const prompt = qMatch[2].trim();
          const contentStart = qMatch.index + qMatch[0].length;
          const contentEnd = qIndex + 1 < questionHeaders.length ? questionHeaders[qIndex + 1].index : questionsSection.length;
          const body = questionsSection.slice(contentStart, contentEnd);
          const options = [];

          for (const line of body.split(/\r?\n/)) {
            const trimmed = line.trim();
            const optionMatch = trimmed.match(/^([A-D])\.\s*(.+)$/);
            if (optionMatch) {
              options.push({ letter: optionMatch[1], text: optionMatch[2].trim() });
            }
          }

          questions.push({ number, prompt, options });
        }

        const answerRows = [...answerSection.matchAll(/^\|\s*(\d+)\s*\|\s*([A-D])\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/gm)];
        const answerMap = new Map();

        for (const row of answerRows) {
          const number = Number(row[1]);
          answerMap.set(number, {
            letter: row[2],
            answerText: row[3].trim(),
            why: row[4].trim()
          });
        }

        const mergedQuestions = questions.map((question) => ({
          ...question,
          answer: answerMap.get(question.number) || null
        }));

        domains.push({
          id: domainId,
          name: domainName,
          questions: mergedQuestions
        });
      }

      domains.sort((a, b) => a.id - b.id);
      return domains;
    }

    function setBankStatus(message, tone = 'neutral') {
      refs.bankStatus.textContent = message;
      refs.bankStatus.style.background = tone === 'error'
        ? 'rgba(255, 124, 124, 0.10)'
        : tone === 'success'
          ? 'rgba(102, 227, 157, 0.10)'
          : 'rgba(96, 217, 197, 0.08)';
      refs.bankStatus.style.borderColor = tone === 'error'
        ? 'rgba(255, 124, 124, 0.22)'
        : tone === 'success'
          ? 'rgba(102, 227, 157, 0.22)'
          : 'rgba(96, 217, 197, 0.2)';
    }

    function syncDomainUI() {
      const hasBank = Boolean(state.bank && state.bank.length);
      refs.domainSelect.innerHTML = '';
      refs.domainCards.innerHTML = '';

      if (!hasBank) {
        refs.domainSelect.disabled = true;
        refs.durationInput.disabled = true;
        refs.startBtn.disabled = true;
        refs.loadedQuestions.textContent = '0';
        refs.currentDomainLabel.textContent = 'None';
        refs.questionTotal.textContent = '120';
        refs.answeredCount.textContent = '0';
        refs.markedCount.textContent = '0';
        refs.progressText.textContent = '0 answered / 120';
        refs.progressFill.style.width = '0%';
        refs.navigator.innerHTML = '';
        return;
      }

      const totalQuestions = state.bank.reduce((sum, domain) => sum + domain.questions.length, 0);
      refs.loadedQuestions.textContent = String(totalQuestions);
      refs.domainSelect.disabled = false;
      refs.durationInput.disabled = false;
      refs.startBtn.disabled = false;

      state.bank.forEach((domain) => {
        const option = document.createElement('option');
        option.value = String(domain.id);
        option.textContent = `Domain ${domain.id} · ${domain.name}`;
        refs.domainSelect.appendChild(option);

        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'domain-card';
        card.innerHTML = `
          <strong>Domain ${domain.id}</strong>
          <span>${domain.name}</span>
          <small>${domain.questions.length} questions · timed 120-question practice exam</small>
        `;
        card.addEventListener('click', () => {
        animateButtonClick(card);
        state.currentDomainId = domain.id;
        refs.domainSelect.value = String(domain.id);
        refs.currentDomainLabel.textContent = `Domain ${domain.id}`;

        highlightDomainCards(domain.id);

        setBankStatus(`Selected Domain ${domain.id}: ${domain.name}. Start the exam when you're ready.`, 'success');
      });
        refs.domainCards.appendChild(card);
      });

      if (!state.currentDomainId) {
        state.currentDomainId = state.bank[0].id;
      }
      refs.domainSelect.value = String(state.currentDomainId);
      highlightDomainCards(state.currentDomainId);
      refs.currentDomainLabel.textContent = `Domain ${state.currentDomainId}`;
    }

    function highlightDomainCards(activeId) {
    [...refs.domainCards.children].forEach((card, index) => {
    const domain = state.bank[index];
    const isActive = domain.id === activeId;

    card.classList.toggle('active', isActive);
    card.classList.toggle('is-active', isActive);
     });
    }

    function getCurrentDomain() {
      if (!state.bank) return null;
      return state.bank.find((domain) => domain.id === state.currentDomainId) || null;
    }

    function getAnsweredCount() {
      return state.activeQuestions.filter((question) => state.answers.has(question.number)).length;
    }

    function getMarkedCount() {
      return state.activeQuestions.filter((question) => state.flagged.has(question.number)).length;
    }

    function updateProgress() {
      const answered = getAnsweredCount();
      const total = state.activeQuestions.length || 120;
      const percent = total ? (answered / total) * 100 : 0;
      refs.answeredCount.textContent = String(answered);
      refs.markedCount.textContent = String(getMarkedCount());
      refs.progressText.textContent = `${answered} answered / ${total}`;
      refs.progressFill.style.width = `${percent}%`;
      refs.localAnswered.textContent = String(answered);
      if (state.activeQuestions.length) {
        refs.questionTotal.textContent = String(state.activeQuestions.length);
      }
    }

    function renderNavigator() {
      refs.navigator.innerHTML = '';
      state.activeQuestions.forEach((question, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        const answered = state.answers.has(question.number);
        const flagged = state.flagged.has(question.number);
        button.className = ['nav-item', answered ? 'answered' : '', flagged ? 'flagged' : '', index === state.currentQuestionIndex ? 'current' : ''].filter(Boolean).join(' ');
        button.textContent = String(index + 1);
        button.title = `Question ${index + 1}${answered ? ' - answered' : ''}${flagged ? ' - flagged' : ''}`;
        button.addEventListener('click', () => {
          state.currentQuestionIndex = index;
          renderQuestion();
          renderNavigator();
        });
        refs.navigator.appendChild(button);
      });
      updateProgress();
    }

    function renderQuestion() {
      const domain = getCurrentDomain();
      if (!domain || !state.activeQuestions.length) {
        refs.emptyQuestionState.classList.remove('hidden');
        refs.questionBody.classList.add('hidden');
        refs.questionTitle.textContent = 'Load a domain to begin';
        refs.domainHeading.textContent = 'Domain';
        return;
      }

      const question = state.activeQuestions[state.currentQuestionIndex];
      const selected = state.answers.get(question.number) || null;
      refs.emptyQuestionState.classList.add('hidden');
      refs.questionBody.classList.remove('hidden');
      refs.questionTitle.textContent = `Question ${state.currentQuestionIndex + 1}`;
      refs.domainHeading.textContent = `Domain ${domain.id} · ${domain.name}`;
      refs.questionCounter.textContent = String(state.currentQuestionIndex + 1);
      refs.questionTotal.textContent = String(state.activeQuestions.length);
      refs.questionText.textContent = question.prompt;
      refs.localAnswered.textContent = String(getAnsweredCount());
      refs.markBtn.textContent = state.flagged.has(question.number) ? 'Unmark review' : 'Mark for review';
      refs.prevBtn.disabled = state.currentQuestionIndex === 0;
      refs.nextBtn.disabled = state.currentQuestionIndex === state.activeQuestions.length - 1;

      refs.optionsList.innerHTML = '';
      question.options.forEach((option) => {
        const label = document.createElement('label');
        label.className = `option ${selected === option.letter ? 'selected' : ''}`;
        label.innerHTML = `
          <input type="radio" name="question-${question.number}" value="${option.letter}" ${selected === option.letter ? 'checked' : ''}>
          <strong>${option.letter}.</strong>
          <span>${option.text}</span>
        `;
        label.querySelector('input').addEventListener('change', () => {
          state.answers.set(question.number, option.letter);
          renderNavigator();
          renderQuestion();
        });
        refs.optionsList.appendChild(label);
      });
    }

    function startTimer() {
      stopTimer();
      state.examStartedAt = Date.now();
      state.examSubmittedAt = null;

      const tick = () => {
        if (state.remainingSeconds <= 0) {
          state.remainingSeconds = 0;
          refreshTimer();
          submitExam(true);
          return;
        }

        refreshTimer();
        state.remainingSeconds -= 1;
      };

      tick();
      state.timerHandle = window.setInterval(tick, 1000);
    }

    function stopTimer() {
      if (state.timerHandle) {
        window.clearInterval(state.timerHandle);
        state.timerHandle = null;
      }
    }

    function refreshTimer() {
      const isRunning = Boolean(state.examStartedAt && !state.examSubmittedAt);
      const displaySeconds = isRunning ? state.remainingSeconds : state.configuredDurationSeconds;
      const display = formatDuration(displaySeconds);
      refs.timerDisplay.textContent = display;
      refs.inlineTimer.textContent = display;
      refs.timerDisplay.style.color = isRunning && state.remainingSeconds <= 300 ? 'var(--danger)' : 'var(--accent)';
      refs.inlineTimer.style.color = isRunning && state.remainingSeconds <= 300 ? 'var(--danger)' : 'var(--accent)';
      if (isRunning && state.activeQuestions.length) {
        const used = clamp(state.timerDurationSeconds - state.remainingSeconds, 0, state.timerDurationSeconds);
        refs.progressFill.style.width = `${Math.max((getAnsweredCount() / state.activeQuestions.length) * 100, 0)}%`;
        document.documentElement.style.setProperty('--timer-used', String(used));
      }
    }

    function loadDomain(domainId) {
      const domain = state.bank?.find((item) => item.id === domainId);
      if (!domain) return;

      state.currentDomainId = domainId;
      state.activeQuestions = domain.questions;
      state.currentQuestionIndex = 0;
      state.answers = new Map();
      state.flagged = new Set();
      state.remainingSeconds = state.configuredDurationSeconds;
      refs.currentDomainLabel.textContent = `Domain ${domain.id}`;
      refs.examArea.classList.remove('hidden');
      refs.resultsArea.classList.add('hidden');
      renderNavigator();
      renderQuestion();
      updateProgress();
      refreshTimer();
      setBankStatus(`Loaded Domain ${domain.id}: ${domain.name}. You are ready to start the timed attempt.`, 'success');
    }

    let noticeAutoCloseHandle = null;

function hideExamNotice(scrollTarget = null) {
  if (!refs.examStartOverlay) return;

  refs.examStartOverlay.classList.add('hidden');

  if (noticeAutoCloseHandle) {
    window.clearTimeout(noticeAutoCloseHandle);
    noticeAutoCloseHandle = null;
  }

  if (scrollTarget) {
    scrollTarget.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
}

function showExamNotice({
  eyebrow = 'Timed attempt',
  title = 'Exam is already starting',
  message = 'Scroll down to see the exam. Your timer has started.',
  actionText = 'Go to exam now',
  dismissText = 'Stay here',
  autoCloseMs = 2500,
  scrollTarget = refs.examArea,
  showSpinner = false,
  hideActions = false
} = {}) {
  if (!refs.examStartOverlay) return;

  const eyebrowEl = refs.examStartOverlay.querySelector('.eyebrow');
  const titleEl = refs.examStartOverlay.querySelector('#examStartTitle');
  const messageEl = refs.examStartOverlay.querySelector('.exam-start-modal > p:not(.eyebrow)');
  const actionsEl = refs.examStartOverlay.querySelector('.exam-start-actions');

  if (eyebrowEl) eyebrowEl.textContent = eyebrow;
  if (titleEl) titleEl.textContent = title;
  if (messageEl) messageEl.textContent = message;

  if (refs.examStartScrollBtn) refs.examStartScrollBtn.textContent = actionText;
  if (refs.examStartDismissBtn) refs.examStartDismissBtn.textContent = dismissText;

  let spinnerEl = refs.examStartOverlay.querySelector('.exam-notice-spinner');

  if (!spinnerEl && titleEl) {
    spinnerEl = document.createElement('div');
    spinnerEl.className = 'exam-notice-spinner hidden';
    titleEl.insertAdjacentElement('afterend', spinnerEl);
  }

  if (spinnerEl) {
    spinnerEl.classList.toggle('hidden', !showSpinner);
  }

  if (actionsEl) {
    actionsEl.style.display = hideActions ? 'none' : 'flex';
  }

  refs.examStartOverlay.classList.remove('hidden');

  if (noticeAutoCloseHandle) {
    window.clearTimeout(noticeAutoCloseHandle);
    noticeAutoCloseHandle = null;
  }

  if (autoCloseMs && Number(autoCloseMs) > 0) {
    noticeAutoCloseHandle = window.setTimeout(() => {
      hideExamNotice(scrollTarget);
    }, autoCloseMs);
  }
}

function showExamStartNotice() {
  showExamNotice({
    eyebrow: 'Timed attempt',
    title: 'Exam is already starting',
    message: 'Scroll down to see the exam. Your timer has started.',
    actionText: 'Go to exam now',
    dismissText: 'Stay here',
    autoCloseMs: 2500,
    scrollTarget: refs.examArea,
    showSpinner: false,
    hideActions: false
  });
}

function animateButtonClick(button) {
  if (!button) return;

  button.classList.remove('is-clicking');
  void button.offsetWidth;
  button.classList.add('is-clicking');

  window.setTimeout(() => {
    button.classList.remove('is-clicking');
  }, 280);
}

function setReviewFilterButtonState() {
  if (!refs.reviewAllBtn || !refs.reviewWrongBtn) return;

  refs.reviewAllBtn.classList.toggle('is-active', state.reviewFilter === 'all');
  refs.reviewWrongBtn.classList.toggle('is-active', state.reviewFilter === 'wrong');
}

      function beginExam() {
    if (!state.bank || !state.bank.length) {
      setBankStatus('Load ccexam.txt first, then start the exam.', 'error');
    return;
      }

      const selectedDomainId = Number(refs.domainSelect.value);
      const duration = clamp(Number(refs.durationInput.value) || 120, 10, 300);
      state.configuredDurationSeconds = duration * 60;
      state.timerDurationSeconds = state.configuredDurationSeconds;
      state.remainingSeconds = state.timerDurationSeconds;
      refs.durationInput.value = String(duration);

      loadDomain(selectedDomainId);
      startTimer();

        refs.examArea.classList.remove('hidden');
        refs.resultsArea.classList.add('hidden');

        showExamStartNotice();
      }

    function computeResults() {
      const domain = getCurrentDomain();
      if (!domain) return null;

      const review = state.activeQuestions.map((question) => {
        const correctLetter = question.answer?.letter || '';
        const correctText = question.answer?.answerText || '';
        const why = question.answer?.why || 'No explanation provided in the bank.';
        const userLetter = state.answers.get(question.number) || '';
        const isCorrect = userLetter && userLetter === correctLetter;
        return { ...question, userLetter, correctLetter, correctText, why, isCorrect };
      });

      const correct = review.filter((item) => item.isCorrect).length;
      const answered = review.filter((item) => item.userLetter).length;
      const wrong = review.filter((item) => item.userLetter && !item.isCorrect).length;
      const unanswered = review.filter((item) => !item.userLetter).length;
      const score = review.length ? Math.round((correct / review.length) * 100) : 0;
      const timeUsed = state.examSubmittedAt && state.examStartedAt
        ? Math.max(0, Math.round((state.examSubmittedAt - state.examStartedAt) / 1000))
        : Math.max(0, state.timerDurationSeconds - state.remainingSeconds);

      return { domain, review, correct, wrong, answered, unanswered, score, timeUsed };
    }

    function submitExam(fromTimer = false) {
  if (state.examSubmittedAt) return;

  stopTimer();
  state.examSubmittedAt = Date.now();

  const results = computeResults();
  if (!results) return;

  showExamNotice({
    eyebrow: fromTimer ? 'Time expired' : 'Submitting exam',
    title: fromTimer ? 'Time is up' : 'Submitting your exam',
    message: fromTimer
      ? 'Your time has expired. The system is scoring your answers now.'
      : 'Please wait while the system checks your answers and prepares your score.',
    autoCloseMs: 0,
    showSpinner: true,
    hideActions: true
  });

  window.setTimeout(() => {
    refs.examArea.classList.add('hidden');
    refs.resultsArea.classList.remove('hidden');

    refs.resultDomain.textContent = `Domain ${results.domain.id}`;
    refs.scoreValue.textContent = `${results.score}%`;
    refs.correctValue.textContent = String(results.correct);
    refs.wrongValue.textContent = String(results.wrong);
    refs.timeUsedValue.textContent = formatDuration(results.timeUsed);
    refs.resultAnswered.textContent = String(results.answered);
    refs.resultFlagged.textContent = String(state.flagged.size);
    refs.resultUnanswered.textContent = String(results.unanswered);

    refs.resultSummary.textContent = fromTimer
      ? 'Time expired. The exam has been scored automatically using the answer key from the bank.'
      : 'The exam has been scored using the answer key from the bank. Review your answers below.';

    state.reviewFilter = 'all';
    setReviewFilterButtonState();
    renderReviewList(results.review);

    showExamNotice({
      eyebrow: 'Results ready',
      title: 'Your exam has been scored',
      message: `You scored ${results.score}%. Scroll down to review your answers.`,
      actionText: 'View results',
      dismissText: 'Close',
      autoCloseMs: 1800,
      scrollTarget: refs.resultsArea,
      showSpinner: false,
      hideActions: false
    });
  }, 1100);
}

    function renderReviewList(review) {
      const items = state.reviewFilter === 'wrong'
        ? review.filter((item) => item.userLetter && !item.isCorrect)
        : review;

      refs.reviewList.innerHTML = '';
      if (!items.length) {
        refs.reviewList.innerHTML = '<div class="empty-state">No questions match the current review filter.</div>';
        return;
      }

      items.forEach((item) => {
        const card = document.createElement('article');
        card.className = `review-item ${item.isCorrect ? 'correct' : 'wrong'}`;
        const answerChoices = item.options.map((option) => {
          const tag = option.letter === item.correctLetter
            ? ' <span class="answer-tag-correct">(correct)</span>'
            : option.letter === item.userLetter
              ? ' <span class="answer-tag-user">(your answer)</span>'
              : '';
          return `<div class="answer-line"><strong>${option.letter}.</strong> ${escapeHtml(option.text)}${tag}</div>`;
        }).join('');

        card.innerHTML = `
          <div class="review-head">
            <div>
              <div class="question-number">Question ${item.number}</div>
              <h3>${escapeHtml(item.prompt)}</h3>
            </div>
            <span class="review-badge ${item.isCorrect ? 'correct' : 'wrong'}">${item.isCorrect ? 'Correct' : 'Incorrect'}</span>
          </div>
          <div class="review-answer">
            <div class="answer-line">Your answer: <strong>${item.userLetter || 'Unanswered'}</strong></div>
            <div class="answer-line">Correct answer: <strong>${item.correctLetter}</strong> - ${escapeHtml(item.correctText)}</div>
            <div class="answer-line">Why: ${escapeHtml(item.why)}</div>
          </div>
          <div class="options">${answerChoices}</div>
        `;
        refs.reviewList.appendChild(card);
      });
    }

    async function loadImportedPayload(payload, fileName = 'Imported bank') {
      const bank = parseImportedContent(payload, fileName);
      if (!bank.length) {
        setBankStatus('The file was loaded, but no questions were detected. Use a file with questions, answer choices, and either inline answers or an answer key.', 'error');
        return;
      }

      state.bank = bank;
      state.currentDomainId = bank[0].id;
      syncDomainUI();
      setBankStatus(`Loaded ${bank.length} domains and ${bank.reduce((sum, domain) => sum + domain.questions.length, 0)} questions. Select a domain and start when ready.`, 'success');
      refs.examArea.classList.add('hidden');
      refs.resultsArea.classList.add('hidden');
      refs.bankOverview.classList.remove('hidden');
    }

    async function handleFile(file) {
      if (!file) return;
      try {
        const payload = await extractPayloadFromFile(file);
        await loadImportedPayload(payload, file.name);
      } catch (error) {
        setBankStatus(`Could not read ${file.name}. ${error.message || 'Try another file format.'}`, 'error');
      }
    }

    async function attemptAutoLoad() {
      try {
        const response = await fetch('ccexam.txt', { cache: 'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        await loadImportedPayload({ kind: 'text', text }, 'ccexam.txt');
      } catch (error) {
        setBankStatus('Auto-load could not read ccexam.txt here. Use the file picker or drag and drop the TXT file into the upload zone.', 'error');
      }
    }

    refs.fileInput.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      await handleFile(file);
    });

    refs.uploadZone.addEventListener('dragover', (event) => {
      event.preventDefault();
      refs.uploadZone.classList.add('dragover');
    });

    refs.uploadZone.addEventListener('dragleave', () => {
      refs.uploadZone.classList.remove('dragover');
    });

    refs.uploadZone.addEventListener('drop', async (event) => {
      event.preventDefault();
      refs.uploadZone.classList.remove('dragover');
      const file = event.dataTransfer.files?.[0];
      await handleFile(file);
    });

    refs.autoLoadBtn.addEventListener('click', attemptAutoLoad);
    refs.startBtn.addEventListener('click', beginExam);
    refs.examStartScrollBtn?.addEventListener('click', () => {
  const target = refs.resultsArea && !refs.resultsArea.classList.contains('hidden')
    ? refs.resultsArea
    : refs.examArea;

  hideExamNotice(target);
});

refs.examStartDismissBtn?.addEventListener('click', () => {
  hideExamNotice();
});

    refs.domainSelect.addEventListener('change', () => {
      state.currentDomainId = Number(refs.domainSelect.value);
      highlightDomainCards(state.currentDomainId);
      refs.currentDomainLabel.textContent = `Domain ${state.currentDomainId}`;
      if (state.bank) {
        const current = getCurrentDomain();
        if (current) {
          refs.bankStatus.textContent = `Selected Domain ${current.id}: ${current.name}. Start the exam when you're ready.`;
        }
      }
    });

    refs.prevBtn.addEventListener('click', () => {
      state.currentQuestionIndex = Math.max(0, state.currentQuestionIndex - 1);
      renderNavigator();
      renderQuestion();
    });

    refs.nextBtn.addEventListener('click', () => {
      state.currentQuestionIndex = Math.min(state.activeQuestions.length - 1, state.currentQuestionIndex + 1);
      renderNavigator();
      renderQuestion();
    });

    refs.markBtn.addEventListener('click', () => {
      const question = state.activeQuestions[state.currentQuestionIndex];
      if (!question) return;
      if (state.flagged.has(question.number)) {
        state.flagged.delete(question.number);
      } else {
        state.flagged.add(question.number);
      }
      renderNavigator();
      renderQuestion();
    });

    refs.clearBtn.addEventListener('click', () => {
      const question = state.activeQuestions[state.currentQuestionIndex];
      if (!question) return;
      state.answers.delete(question.number);
      renderNavigator();
      renderQuestion();
    });

    refs.submitBtn.addEventListener('click', () => { submitExam(false); });

    refs.reviewAllBtn.addEventListener('click', () => {
  animateButtonClick(refs.reviewAllBtn);

  state.reviewFilter = 'all';
  setReviewFilterButtonState();

  const results = computeResults();
  if (results) renderReviewList(results.review);
});

refs.reviewWrongBtn.addEventListener('click', () => {
  animateButtonClick(refs.reviewWrongBtn);

  state.reviewFilter = 'wrong';
  setReviewFilterButtonState();

  const results = computeResults();
  if (results) renderReviewList(results.review);
});

refs.retakeBtn.addEventListener('click', () => {
  animateButtonClick(refs.retakeBtn);

  state.reviewFilter = 'all';
  setReviewFilterButtonState();

  state.examSubmittedAt = null;
  state.examStartedAt = null;
  state.remainingSeconds = state.timerDurationSeconds;

  refs.resultsArea.classList.add('hidden');
  refs.examArea.classList.remove('hidden');

  state.answers = new Map();
  state.flagged = new Set();
  state.currentQuestionIndex = 0;

  renderNavigator();
  renderQuestion();
  refreshTimer();
  startTimer();

  showExamNotice({
    eyebrow: 'Retake attempt',
    title: 'Retake is starting',
    message: 'Your answers have been cleared and your timer has restarted. Scroll down to begin again.',
    actionText: 'Go to retake now',
    dismissText: 'Stay here',
    autoCloseMs: 2500,
    scrollTarget: refs.examArea,
    showSpinner: false,
    hideActions: false
  });
});

    refs.durationInput.addEventListener('change', () => {
      const nextValue = clamp(Number(refs.durationInput.value) || 120, 10, 300);
      refs.durationInput.value = String(nextValue);
      state.configuredDurationSeconds = nextValue * 60;
      if (!state.examStartedAt || state.examSubmittedAt) {
        state.remainingSeconds = state.configuredDurationSeconds;
      }
      refs.statTimer.textContent = `${nextValue} minute timer`;
      refreshTimer();
    });

    window.addEventListener('beforeunload', () => { stopTimer(); });

    refreshTimer();
    syncDomainUI();
    attemptAutoLoad();
