(() => {
const EXT_TO_PAGE_SOURCE = 'JITSI_NAME_EXT';
const PAGE_TO_EXT_SOURCE = 'JITSI_NAME_PAGE';
const INJECTED_SCRIPT_MARKER = 'jitsi-name-injected-script';
const REQUEST_TIMEOUT_MS = 4000;

const QUESTION_AUTOCOPY_STORAGE_KEY = 'iu_question_autocopy_enabled';
const QUESTION_AUTOCOPY_DEBOUNCE_MS = 350;
const QUESTION_SCAN_TICK_MS = 500;
const QUESTION_SCAN_DEFAULT_DURATION_MS = 20000;
const QUESTION_SCAN_MIN_DURATION_MS = 5000;
const QUESTION_SCAN_MAX_DURATION_MS = 60000;
const SCAN_LOG_PREFIX = '[QuestionScanner]';
const MAX_SCANNER_LOGS = 500;

const previousRuntime = window.__godGameContentRuntime;
if (previousRuntime && typeof previousRuntime.runtimeMessageListener === 'function') {
    try {
        chrome.runtime.onMessage.removeListener(previousRuntime.runtimeMessageListener);
    } catch (_error) {
        // no-op
    }
}
    const pendingRequests = new Map();
    let bridgeInjected = false;
    const scannerLogs = [];

    const questionCopyState = {
        enabled: false,
        observer: null,
        debounceTimer: null,
        lastSignature: '',
        lastText: '',
        scan: {
            active: false,
            ready: false,
            startedAt: 0,
            durationMs: QUESTION_SCAN_DEFAULT_DURATION_MS,
            timerId: null,
            lastElapsedMs: 0,
            lastError: '',
            foundCount: 0,
            lastQuestion: '',
            lastOptionsCount: 0,
            payloads: [],
            lastLoggedSecond: -1
        }
    };

    function stringifyLogDetails(details) {
        if (details === undefined) {
            return '';
        }

        if (details instanceof Error) {
            return `${details.name}: ${details.message}`;
        }

        try {
            return JSON.stringify(details);
        } catch (_error) {
            return String(details);
        }
    }

    function appendScannerLog(level, message, details) {
        const entry = {
            ts: new Date().toISOString(),
            level,
            message: String(message || ''),
            details: stringifyLogDetails(details)
        };

        scannerLogs.push(entry);
        if (scannerLogs.length > MAX_SCANNER_LOGS) {
            scannerLogs.splice(0, scannerLogs.length - MAX_SCANNER_LOGS);
        }
    }

    function exportScannerLogsText() {
        const lines = [
            `God Game Question Scanner logs`,
            `Generated: ${new Date().toISOString()}`,
            `URL: ${location.href}`,
            `Stored entries: ${scannerLogs.length}`,
            ''
        ];

        scannerLogs.forEach((entry) => {
            lines.push(`[${entry.ts}] ${entry.level.toUpperCase()} ${entry.message}${entry.details ? ` | ${entry.details}` : ''}`);
        });

        return lines.join('\n');
    }

    function logInfo(message, details) {
        appendScannerLog('info', message, details);
        if (details !== undefined) {
            console.info(SCAN_LOG_PREFIX, message, details);
        } else {
            console.info(SCAN_LOG_PREFIX, message);
        }
    }

    function logWarn(message, details) {
        appendScannerLog('warn', message, details);
        if (details !== undefined) {
            console.warn(SCAN_LOG_PREFIX, message, details);
        } else {
            console.warn(SCAN_LOG_PREFIX, message);
        }
    }

    function logError(message, details) {
        appendScannerLog('error', message, details);
        if (details !== undefined) {
            console.error(SCAN_LOG_PREFIX, message, details);
        } else {
            console.error(SCAN_LOG_PREFIX, message);
        }
    }

    function makeRequestId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }

        return `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    }

    function injectPageBridge() {
        if (bridgeInjected || document.getElementById(INJECTED_SCRIPT_MARKER)) {
            return;
        }

        bridgeInjected = true;
        const script = document.createElement('script');
        script.id = INJECTED_SCRIPT_MARKER;
        script.src = chrome.runtime.getURL('injected.js');
        script.async = false;

        script.onload = () => {
            script.remove();
        };

        script.onerror = () => {
            bridgeInjected = false;
            logError('Не удалось загрузить injected.js');
        };

        (document.head || document.documentElement).appendChild(script);
    }

    function sendToPage(type, payload, sendResponse) {
        injectPageBridge();

        const requestId = makeRequestId();
        const timeoutId = setTimeout(() => {
            if (!pendingRequests.has(requestId)) {
                return;
            }

            pendingRequests.delete(requestId);
            sendResponse({ success: false, error: 'Timeout waiting for page response' });
        }, REQUEST_TIMEOUT_MS);

        pendingRequests.set(requestId, { sendResponse, timeoutId });

        window.postMessage(
            {
                source: EXT_TO_PAGE_SOURCE,
                type,
                requestId,
                ...payload
            },
            '*'
        );
    }

    function stripHtmlTags(html) {
        return String(html || '').replace(/<[^>]*>/g, '');
    }

    function normalizeText(value) {
        return stripHtmlTags(String(value || ''))
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isVisibleElement(element) {
        if (!element) {
            return false;
        }

        const style = window.getComputedStyle(element);
        if (!style) {
            return true;
        }

        return style.display !== 'none' && style.visibility !== 'hidden';
    }

    function getPracticeScope() {
        return document.querySelector('.b-popup.b-practice') || document.querySelector('.b-practice') || document;
    }

    function findQuestionElement(scope) {
        const selectors = [
            '.b-practice__question',
            '.b-practice__condition',
            '.b-practice .b-practice__question'
        ];

        for (const selector of selectors) {
            const nodes = scope.querySelectorAll(selector);
            for (const node of nodes) {
                const text = normalizeText(node.textContent);
                if (!text || text.length < 3) {
                    continue;
                }

                if (!isVisibleElement(node)) {
                    continue;
                }

                return node;
            }
        }

        return null;
    }

    function findModernQuestionBlock(scope) {
        const blocks = scope.querySelectorAll('[class*="question-basestyles__SQuestion"]');
        for (const block of blocks) {
            if (!isVisibleElement(block)) {
                continue;
            }

            const headerNode = block.querySelector(
                '[class*="question-basestyles__SQuestionHeader"] .header,' +
                ' [class*="question-basestyles__SQuestionHeader"] [class*="header"]'
            );

            const headerText = normalizeText(headerNode?.textContent || '');
            if (!headerText || headerText.length < 3) {
                continue;
            }

            return {
                block,
                questionText: headerText
            };
        }

        return null;
    }

    function pushOptionLine(target, seen, line, questionText) {
        const normalized = normalizeText(line);
        if (!normalized) {
            return;
        }

        if (normalized === questionText) {
            return;
        }

        if (seen.has(normalized)) {
            return;
        }

        seen.add(normalized);
        target.push(normalized);
    }

    function getReadableText(element) {
        if (!element) return '';

        const clone = element.cloneNode(true);

        clone.querySelectorAll('.math, .katex').forEach((mathNode) => {
            const annotation = mathNode.querySelector('annotation[encoding="application/x-tex"]');
            const tex = normalizeText(annotation ? annotation.textContent : '');
            if (tex) {
                mathNode.replaceWith(document.createTextNode(tex));
            }
        });

        clone.querySelectorAll('script, style, svg, button, input, textarea, select, label, .result-icon, .katex-mathml, [aria-hidden="true"]').forEach((node) => {
            node.remove();
        });

        clone.querySelectorAll('img').forEach((img) => {
            const alt = normalizeText(img.getAttribute('alt') || 'изображение');
            const src = img.getAttribute('src') || '';
            img.replaceWith(document.createTextNode(src ? `[${alt}: ${src}]` : `[${alt}]`));
        });

        return normalizeText(clone.textContent || '');
    }

    function extractQuestionCondition(contextNode) {
        const conditionNodes = contextNode.querySelectorAll(
            '[class*="question-basestyles__SQuestionText"],' +
            ' [class*="input-questionstyles__SInputQuestionText"]'
        );

        const conditions = [];
        conditionNodes.forEach((node) => {
            const text = getReadableText(node);
            if (text && !conditions.includes(text)) {
                conditions.push(text);
            }
        });

        return conditions.join(' ');
    }

    function extractQuestionComment(contextNode) {
        const commentNodes = contextNode.querySelectorAll('[class*="question-basestyles__SQuestionComment"]');
        const comments = [];
        commentNodes.forEach(node => {
            const text = getReadableText(node);
            if (text && !comments.includes(text)) {
                comments.push(text);
            }
        });
        return comments.join(' ');
    }

    function extractMultipleChoiceOptions(questionRoot, questionText) {
        const lines = [];
        const seen = new Set();
        const items = questionRoot.querySelectorAll(
            '[class*="one-from-manystyles__SAnswerBaseFromMany"],' +
            ' [class*="many-from-manystyles__SAnswerBaseFromMany"], .answer'
        );

        items.forEach((item) => {
            const textNode = item.querySelector('.answer__text') || item.querySelector('[class*="SAnswerText"]') || item;
            pushOptionLine(lines, seen, getReadableText(textNode), questionText);
        });

        return lines;
    }

    function extractDragMatchOptions(questionRoot, questionText) {
        const lines = [];
        const seen = new Set();

        const leftParts = [];
        questionRoot.querySelectorAll('[class*="drop-sectionstyles__SDropSectionContainer"] p').forEach((node) => {
            const text = getReadableText(node);
            if (text && !leftParts.includes(text)) {
                leftParts.push(text);
            }
        });

        const rightParts = [];
        questionRoot.querySelectorAll('[class*="drag-answerstyles__SAnswer"] span').forEach((node) => {
            const text = getReadableText(node);
            if (text && !rightParts.includes(text)) {
                rightParts.push(text);
            }
        });

        leftParts.forEach((line) => pushOptionLine(lines, seen, `Поле: ${line}`, questionText));
        rightParts.forEach((line) => pushOptionLine(lines, seen, `Ответ: ${line}`, questionText));

        return lines;
    }

    function extractInputQuestionOptions(questionRoot, questionText) {
        const lines = [];
        const inputs = questionRoot.querySelectorAll('input[type="text"], textarea');
        if (inputs.length > 0) {
            lines.push(inputs.length === 1 ? 'Поле для текстового ответа' : `Поля для текстового ответа: ${inputs.length}`);
        }
        return lines.filter((line) => line !== questionText);
    }

    function extractOptionLines(scope, questionText, contextNode = null) {
        const questionRoot = contextNode || scope;
        const lines = [];
        const seen = new Set();

        extractMultipleChoiceOptions(questionRoot, questionText).forEach((line) => pushOptionLine(lines, seen, line, questionText));
        extractDragMatchOptions(questionRoot, questionText).forEach((line) => pushOptionLine(lines, seen, line, questionText));
        extractInputQuestionOptions(questionRoot, questionText).forEach((line) => pushOptionLine(lines, seen, line, questionText));

        logInfo('Извлечены варианты/элементы вопроса', {
            count: lines.length,
            question: questionText.substring(0, 50)
        });

        return lines;
    }

    function ensureOptionPrefix(line, index) {
        if (/^[A-Za-zА-Яа-я0-9]+\)/.test(line)) {
            return line;
        }

        return `${index + 1}) ${line}`;
    }

    function buildCopyText(question, options, condition = '', comment = '') {
        const parts = [`Вопрос:\n${question}`];

        if (comment) {
            parts.push(`Условия:\n${comment}`);
        }

        if (condition) {
            parts.push(`Текст:\n${condition}`);
        }

        if (options.length > 0) {
            const optionLines = options.map((line, index) => ensureOptionPrefix(line, index));
            parts.push(`Варианты ответа:\n${optionLines.join('\n')}`);
        }

        return parts.join('\n\n');
    }

    function buildCombinedCopyText(payloads) {
        if (!payloads || payloads.length === 0) {
            return '';
        }

        if (payloads.length === 1) {
            return payloads[0].text;
        }

        return payloads
            .map((payload, index) => {
                return `=== Вопрос ${index + 1} ===\n${payload.text || buildCopyText(payload.question, payload.options, payload.condition, payload.comment)}`;
            })
            .join('\n\n');
    }

    function buildCombinedSignature(payloads) {
        if (!payloads || payloads.length === 0) {
            return '';
        }

        return payloads.map((payload) => payload.signature).join('||#||');
    }


    function getDirectTableCells(row) {
        return Array.from(row.children).filter((child) => child && child.tagName === 'TD');
    }

    function getSubjectNameFromCell(cell) {
        if (!cell) return '';
        const titledNode = cell.querySelector('[title]');
        const title = normalizeText(titledNode ? titledNode.getAttribute('title') : '');
        return title || normalizeText(cell.textContent);
    }

    function calculateFinalMark(average) {
        if (!Number.isFinite(average)) return null;
        if (average >= 4.5) return 5;
        if (average >= 3.5) return 4;
        if (average >= 2.5) return 3;
        return 2;
    }

    function extractJournalGrades() {
        const journalTable = document.querySelector('table[data-sticky-table="true"]') || document.querySelector('table');
        if (!journalTable) {
            return { success: false, error: 'Таблица журнала на странице не найдена' };
        }

        const bodyRows = Array.from(journalTable.querySelectorAll(':scope > tbody > tr'));
        if (bodyRows.length === 0) {
            return { success: false, error: 'Строки с предметами не найдены' };
        }

        const subjects = [];
        bodyRows.forEach((row) => {
            const cells = getDirectTableCells(row);
            if (cells.length < 2) return;

            const subjectName = getSubjectNameFromCell(cells[0]);
            if (!subjectName) return;

            const gradeCells = cells.slice(1, Math.max(1, cells.length - 1));
            const marks = [];

            gradeCells.forEach((cell) => {
                cell.querySelectorAll('.default-mark').forEach((node) => {
                    const mark = Number(normalizeText(node.textContent));
                    if ([2, 3, 4, 5].includes(mark)) marks.push(mark);
                });
            });

            const sum = marks.reduce((acc, value) => acc + value, 0);
            const average = marks.length > 0 ? sum / marks.length : null;
            const finalMark = calculateFinalMark(average);

            subjects.push({
                subject: subjectName,
                marks,
                marksCount: marks.length,
                average: average === null ? null : Number(average.toFixed(2)),
                finalMark
            });
        });

        if (subjects.length === 0) {
            return { success: false, error: 'Предметы в таблице не распознаны' };
        }

        return {
            success: true,
            subjects,
            totalSubjects: subjects.length,
            subjectsWithMarks: subjects.filter((item) => item.marksCount > 0).length
        };
    }


    function extractQuestionPayloads() {
        const scope = getPracticeScope();
        const payloads = [];
        const signatureSet = new Set();

        const modernBlocks = scope.querySelectorAll('div[id][class*="question-basestyles__SQuestion"]');
        modernBlocks.forEach((block) => {
            if (!isVisibleElement(block)) {
                return;
            }

            const headerNode = block.querySelector(
                ':scope > [class*="question-basestyles__SQuestionHeader"] .header,' +
                ' :scope > [class*="question-basestyles__SQuestionHeader"] [class*="header"]'
            );

            if (!headerNode) {
                logInfo('Пропущен вложенный/служебный блок без прямого заголовка вопроса', {
                    id: block.id || '',
                    className: String(block.className || '').slice(0, 80)
                });
                return;
            }

            const questionText = normalizeText(headerNode?.textContent || '');
            if (!questionText || questionText.length < 3) {
                return;
            }

            const condition = extractQuestionCondition(block);
            const comment = extractQuestionComment(block);
            const options = extractOptionLines(scope, questionText, block);
            const signature = `${questionText}||${condition}||${comment}||${options.join('||')}`;
            if (signatureSet.has(signature)) {
                logInfo('Дубликат вопроса пропущен', { question: questionText.substring(0, 50) });
                return;
            }

            signatureSet.add(signature);
            logInfo('Вопрос найден', { id: block.id, question: questionText.substring(0, 50), optionsCount: options.length, conditionLength: condition.length, commentLength: comment.length, condition: condition.substring(0, 50), comment: comment.substring(0, 50) });
            payloads.push({
                question: questionText,
                options,
                condition,
                comment,
                text: buildCopyText(questionText, options, condition, comment),
                signature
            });
        });

        if (payloads.length > 0) {
            return {
                success: true,
                payloads
            };
        }

        const questionElement = findQuestionElement(scope);

        if (!questionElement) {
            return {
                success: false,
                error: 'Вопрос на странице не найден'
            };
        }

        const questionText = normalizeText(questionElement.textContent);
        if (!questionText) {
            return {
                success: false,
                error: 'Текст вопроса пустой'
            };
        }

        const condition = '';
        const comment = '';
        const options = extractOptionLines(scope, questionText, questionElement);
        const text = buildCopyText(questionText, options, condition, comment);
        const signature = `${questionText}||${condition}||${comment}||${options.join('||')}`;

        return {
            success: true,
            payloads: [
                {
                    question: questionText,
                    options,
                    condition,
                    comment,
                    text,
                    signature
                }
            ]
        };
    }

    function copyUsingExecCommand(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';

        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();

        let copied = false;
        try {
            copied = document.execCommand('copy');
        } catch (_error) {
            copied = false;
        }

        textarea.remove();
        return copied;
    }

    function copyTextToClipboard(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(text)
                .then(() => true)
                .catch(() => copyUsingExecCommand(text));
        }

        return Promise.resolve(copyUsingExecCommand(text));
    }

    function clearScanTimer() {
        if (questionCopyState.scan.timerId) {
            clearInterval(questionCopyState.scan.timerId);
            questionCopyState.scan.timerId = null;
        }
    }

    function getScanStatus() {
        const scan = questionCopyState.scan;
        const elapsedMs = scan.active
            ? Date.now() - scan.startedAt
            : scan.lastElapsedMs;

        return {
            active: scan.active,
            ready: scan.ready,
            startedAt: scan.startedAt,
            durationMs: scan.durationMs,
            elapsedMs,
            lastError: scan.lastError,
            foundCount: scan.foundCount,
            lastQuestion: scan.lastQuestion,
            lastOptionsCount: scan.lastOptionsCount
        };
    }

    function finishScan(success, errorMessage) {
        const scan = questionCopyState.scan;
        scan.active = false;
        scan.lastElapsedMs = Math.max(0, Date.now() - scan.startedAt);
        clearScanTimer();

        if (success) {
            scan.ready = true;
            scan.lastError = '';
            logInfo(`Сканирование завершено успешно за ${scan.lastElapsedMs} мс`, {
                foundCount: scan.foundCount,
                question: scan.lastQuestion,
                options: scan.lastOptionsCount
            });
        } else {
            scan.ready = false;
            scan.lastError = errorMessage || 'Вопрос не найден';
            logWarn(`Сканирование завершено без результата: ${scan.lastError}`);
        }
    }

    function scanStep() {
        const scan = questionCopyState.scan;
        if (!scan.active) {
            return;
        }

        const elapsedMs = Date.now() - scan.startedAt;
        scan.lastElapsedMs = elapsedMs;

        const elapsedSeconds = Math.floor(elapsedMs / 1000);
        if (elapsedSeconds !== scan.lastLoggedSecond) {
            scan.lastLoggedSecond = elapsedSeconds;
            logInfo(`Сканирование... ${elapsedSeconds}с / ${Math.floor(scan.durationMs / 1000)}с`);
        }

        let scanResult;
        try {
            scanResult = extractQuestionPayloads();
        } catch (error) {
            logError('Ошибка во время сканирования DOM', error);
            finishScan(false, 'Ошибка чтения страницы');
            return;
        }

        if (scanResult.success) {
            const payloads = scanResult.payloads || [];
            const first = payloads[0] || null;

            scan.payloads = payloads;
            scan.foundCount = payloads.length;
            scan.lastQuestion = first ? first.question : '';
            scan.lastOptionsCount = first ? first.options.length : 0;
            finishScan(true, '');
            return;
        }

        if (elapsedMs >= scan.durationMs) {
            finishScan(false, scanResult.error || 'Вопросы не найдены');
        }
    }

    function clampDuration(value) {
        const asNumber = Number(value);
        if (!Number.isFinite(asNumber)) {
            return QUESTION_SCAN_DEFAULT_DURATION_MS;
        }

        return Math.min(
            QUESTION_SCAN_MAX_DURATION_MS,
            Math.max(QUESTION_SCAN_MIN_DURATION_MS, Math.round(asNumber))
        );
    }

    function startQuestionScan(durationMs) {
        const scan = questionCopyState.scan;

        if (scan.active) {
            logInfo('Сканирование уже запущено');
            return {
                success: true,
                status: getScanStatus()
            };
        }

        scan.active = true;
        scan.ready = false;
        scan.startedAt = Date.now();
        scan.durationMs = clampDuration(durationMs);
        scan.lastElapsedMs = 0;
        scan.lastError = '';
        scan.foundCount = 0;
        scan.lastQuestion = '';
        scan.lastOptionsCount = 0;
        scan.payloads = [];
        scan.lastLoggedSecond = -1;

        // При новом сканировании выключаем автокопирование до получения результата.
        questionCopyState.enabled = false;
        stopQuestionObserver();

        logInfo('Запуск сканирования страницы', { durationMs: scan.durationMs });
        scanStep();

        if (scan.active) {
            scan.timerId = setInterval(() => {
                scanStep();
            }, QUESTION_SCAN_TICK_MS);
        }

        return {
            success: true,
            status: getScanStatus()
        };
    }

    function copyCurrentQuestion(force) {
        const scan = questionCopyState.scan;

        if (!scan.ready) {
            return Promise.resolve({
                success: false,
                error: 'Сначала нажмите «Сканировать»'
            });
        }

        let payloads = Array.isArray(scan.payloads) ? scan.payloads : [];
        if (payloads.length === 0) {
            const scanResult = extractQuestionPayloads();
            if (!scanResult.success) {
                return Promise.resolve(scanResult);
            }
            payloads = scanResult.payloads || [];
            scan.payloads = payloads;
            scan.foundCount = payloads.length;
        }

        const combinedText = buildCombinedCopyText(payloads);
        const combinedSignature = buildCombinedSignature(payloads);
        const firstPayload = payloads[0] || { question: '', options: [] };

        if (!force && combinedSignature === questionCopyState.lastSignature) {
            logInfo('Вопросы не изменились, пропуск копирования');
            return Promise.resolve({
                success: true,
                copied: false,
                text: combinedText,
                question: firstPayload.question,
                options: firstPayload.options,
                foundCount: payloads.length,
                reason: 'same-question'
            });
        }

        logInfo('Копирование вопросов', { foundCount: payloads.length, totalTextLength: combinedText.length });
        return copyTextToClipboard(combinedText).then((copied) => {
            if (!copied) {
                logError('Не удалось скопировать текст в буфер');
                return {
                    success: false,
                    error: 'Не удалось скопировать текст в буфер'
                };
            }

            questionCopyState.lastSignature = combinedSignature;
            questionCopyState.lastText = combinedText;

            logInfo('Вопросы скопированы в буфер', {
                foundCount: payloads.length,
                question: firstPayload.question.substring(0, 50),
                options: firstPayload.options.length
            });

            return {
                success: true,
                copied: true,
                text: combinedText,
                question: firstPayload.question,
                options: firstPayload.options,
                foundCount: payloads.length
            };
        });
    }

    function scheduleAutoQuestionCopy() {
        if (!questionCopyState.enabled || !questionCopyState.scan.ready) {
            return;
        }

        if (questionCopyState.debounceTimer) {
            clearTimeout(questionCopyState.debounceTimer);
        }

        questionCopyState.debounceTimer = setTimeout(() => {
            copyCurrentQuestion(false).catch((error) => {
                logError('Автокопирование завершилось с ошибкой', error);
            });
        }, QUESTION_AUTOCOPY_DEBOUNCE_MS);
    }

    function startQuestionObserver() {
        if (questionCopyState.observer || !questionCopyState.scan.ready) {
            return;
        }

        if (!document.body) {
            return;
        }

        questionCopyState.observer = new MutationObserver(() => {
            scheduleAutoQuestionCopy();
        });

        questionCopyState.observer.observe(document.body, {
            childList: true,
            subtree: true,
            characterData: true
        });

        logInfo('Автокопирование: observer запущен');
        scheduleAutoQuestionCopy();
    }

    function stopQuestionObserver() {
        if (questionCopyState.observer) {
            questionCopyState.observer.disconnect();
            questionCopyState.observer = null;
            logInfo('Автокопирование: observer остановлен');
        }

        if (questionCopyState.debounceTimer) {
            clearTimeout(questionCopyState.debounceTimer);
            questionCopyState.debounceTimer = null;
        }
    }

    function applyQuestionAutoCopyState(enabled) {
        const canEnable = Boolean(enabled) && questionCopyState.scan.ready;
        questionCopyState.enabled = canEnable;

        if (questionCopyState.enabled) {
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    startQuestionObserver();
                }, { once: true });
            } else {
                startQuestionObserver();
            }
        } else {
            stopQuestionObserver();
        }
    }

    function saveQuestionAutoCopyState(enabled, callback) {
        applyQuestionAutoCopyState(enabled);

        chrome.storage.local.set({ [QUESTION_AUTOCOPY_STORAGE_KEY]: questionCopyState.enabled }, () => {
            if (callback) {
                callback();
            }
        });
    }

    function loadQuestionAutoCopyState() {
        chrome.storage.local.get([QUESTION_AUTOCOPY_STORAGE_KEY], (result) => {
            const enabled = Boolean(result && result[QUESTION_AUTOCOPY_STORAGE_KEY]);
            applyQuestionAutoCopyState(enabled);
        });
    }

    window.addEventListener('message', (event) => {
        if (event.source !== window) {
            return;
        }

        const data = event.data;
        if (!data || data.source !== PAGE_TO_EXT_SOURCE || !data.requestId) {
            return;
        }

        const pending = pendingRequests.get(data.requestId);
        if (!pending) {
            return;
        }

        clearTimeout(pending.timeoutId);
        pendingRequests.delete(data.requestId);

        if (data.type === 'JITSI_NAME_RESPONSE') {
            pending.sendResponse({ name: data.name, error: data.error || null });
            return;
        }

        if (data.type === 'JITSI_SET_NAME_RESPONSE') {
            pending.sendResponse({ success: Boolean(data.success), error: data.error || null });
        }
    });

    const runtimeMessageListener = (request, _sender, sendResponse) => {
        try {
            if (!request || !request.action) {
                return false;
            }

            if (request.action === 'getName') {
                sendToPage('JITSI_GET_NAME', {}, sendResponse);
                return true;
            }

            if (request.action === 'setName') {
                sendToPage('JITSI_SET_NAME', { name: request.name }, sendResponse);
                return true;
            }

            if (request.action === 'startQuestionScan') {
                const result = startQuestionScan(request.durationMs);
                sendResponse(result);
                return false;
            }

            if (request.action === 'getQuestionScanStatus') {
                sendResponse({
                    success: true,
                    status: getScanStatus()
                });
                return false;
            }

            if (request.action === 'copyQuestionNow') {
                copyCurrentQuestion(Boolean(request.force))
                    .then((result) => sendResponse(result))
                    .catch((error) => {
                        logError('Ошибка ручного копирования', error);
                        sendResponse({
                            success: false,
                            error: error && error.message ? error.message : 'Ошибка копирования вопроса'
                        });
                    });
                return true;
            }

            if (request.action === 'setQuestionAutoCopy') {
                if (Boolean(request.enabled) && !questionCopyState.scan.ready) {
                    sendResponse({
                        success: false,
                        error: 'Сначала нажмите «Сканировать»'
                    });
                    return false;
                }

                saveQuestionAutoCopyState(Boolean(request.enabled), () => {
                    sendResponse({
                        success: true,
                        enabled: questionCopyState.enabled
                    });
                });
                return true;
            }

            if (request.action === 'getQuestionAutoCopyState') {
                sendResponse({
                    success: true,
                    enabled: questionCopyState.enabled && questionCopyState.scan.ready
                });
                return false;
            }

            if (request.action === 'getQuestionScannerLogs') {
                sendResponse({
                    success: true,
                    text: exportScannerLogsText(),
                    count: scannerLogs.length
                });
                return false;
            }


            if (request.action === 'calculateJournalGrades') {
                sendResponse(extractJournalGrades());
                return false;
            }

            return false;
        } catch (error) {
            logError('Исключение в runtimeMessageListener', error);
            try {
                sendResponse({
                    success: false,
                    error: error && error.message ? error.message : 'Внутренняя ошибка content.js'
                });
            } catch (_sendError) {
                // no-op
            }
            return false;
        }
    };

    chrome.runtime.onMessage.addListener(runtimeMessageListener);

    window.__godGameContentApi = {
        ensureBridge: injectPageBridge
    };

    window.__godGameContentRuntime = {
        runtimeMessageListener,
        ensureBridge: injectPageBridge,
        version: 2
    };

    logInfo('content.js инициализирован', {
        href: window.location.href,
        version: window.__godGameContentRuntime.version
    });

    injectPageBridge();
    loadQuestionAutoCopyState();

})();

