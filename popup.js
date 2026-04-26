const STORAGE_KEY_HISTORY = 'jitsi_name_history';
const STORAGE_KEY_LAST_QUESTION_COPY = 'question_last_copy_text';
const STORAGE_KEY_THEME = 'god_game_theme';
const MAX_HISTORY_ITEMS = 50;

const TAB_JITSI = 'jitsi';
const TAB_QUESTION = 'question';
const TAB_GRADES = 'grades';
const SCAN_POLL_INTERVAL_MS = 500;

const ERR_UNSUPPORTED_TAB = 'На этой вкладке функция недоступна';
const POPUP_LOG_PREFIX = '[PopupScanner]';

document.addEventListener('DOMContentLoaded', () => {
    const currentNameEl = document.getElementById('currentName');
    const newNameInput = document.getElementById('newName');
    const changeBtn = document.getElementById('changeBtn');
    const injectBtn = document.getElementById('injectBtn');
    const statusEl = document.getElementById('status');
    const historyListEl = document.getElementById('historyList');
    const clearHistoryBtn = document.getElementById('clearHistoryBtn');
    const pageHostEl = document.getElementById('pageHost');
    const keysListEl = document.getElementById('keysList');
    const settingsToggleBtn = document.getElementById('settingsToggle');
    const settingsMenuEl = document.getElementById('settingsMenu');
    const themeLightBtn = document.getElementById('themeLightBtn');
    const themeDarkBtn = document.getElementById('themeDarkBtn');

    const tabJitsiBtn = document.getElementById('tabJitsi');
    const tabQuestionBtn = document.getElementById('tabQuestion');
    const tabGradesBtn = document.getElementById('tabGrades');
    const panelJitsiEl = document.getElementById('panelJitsi');
    const panelQuestionEl = document.getElementById('panelQuestion');
    const panelGradesEl = document.getElementById('panelGrades');

    const scanBtn = document.getElementById('scanBtn');
    const scanProgressEl = document.getElementById('scanProgress');
    const autoCopyBtn = document.getElementById('autoCopyBtn');
    const copyNowBtn = document.getElementById('copyNowBtn');
    const clearCopiedBtn = document.getElementById('clearCopiedBtn');
    const downloadQuestionLogsBtn = document.getElementById('downloadQuestionLogsBtn');
    const copiedQuestionEl = document.getElementById('copiedQuestion');
    const questionStatusEl = document.getElementById('questionStatus');
    const refreshGradesBtn = document.getElementById('refreshGradesBtn');
    const gradesSummaryEl = document.getElementById('gradesSummary');
    const gradesListEl = document.getElementById('gradesList');
    const gradesStatusEl = document.getElementById('gradesStatus');
    const audioStatusEl = document.getElementById('audioStatus');
    const playAudioBtn = document.getElementById('playAudioBtn');

    let mainStatusTimer = null;
    let questionStatusTimer = null;
    let gradesStatusTimer = null;
    let questionAutoEnabled = false;
    let scanPollingTimer = null;
    let scanReady = false;
    let scanActive = false;

    function popupInfo(message, details) {
        if (details !== undefined) {
            console.info(POPUP_LOG_PREFIX, message, details);
        } else {
            console.info(POPUP_LOG_PREFIX, message);
        }
    }

    function popupWarn(message, details) {
        if (details !== undefined) {
            console.warn(POPUP_LOG_PREFIX, message, details);
        } else {
            console.warn(POPUP_LOG_PREFIX, message);
        }
    }

    function popupError(message, details) {
        if (details !== undefined) {
            console.error(POPUP_LOG_PREFIX, message, details);
        } else {
            console.error(POPUP_LOG_PREFIX, message);
        }
    }

    initThemeSettings();
    initTabs();
    loadHistory();
    loadLastCopiedQuestion();
    refreshPageInfo();
    refreshCurrentName();
    setupQuestionPanelDefaults();
    syncQuestionPanelState(false);

    if (newNameInput) {
        newNameInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter') {
                event.preventDefault();
                applyNameChange();
            }
        });
    }

    if (changeBtn) {
        changeBtn.addEventListener('click', applyNameChange);
    }

    if (injectBtn) {
        injectBtn.addEventListener('click', reinjectBridge);
    }

    if (clearHistoryBtn) {
        clearHistoryBtn.addEventListener('click', () => {
            chrome.storage.local.remove([STORAGE_KEY_HISTORY], () => {
                renderHistory([]);
                showMainStatus('История очищена', 'info');
            });
        });
    }

    if (scanBtn) {
        scanBtn.addEventListener('click', startQuestionScan);
    }

    if (copyNowBtn) {
        copyNowBtn.addEventListener('click', copyQuestionNow);
    }

    if (autoCopyBtn) {
        autoCopyBtn.addEventListener('click', toggleQuestionAutoCopy);
    }

    if (clearCopiedBtn) {
        clearCopiedBtn.addEventListener('click', () => {
            copiedQuestionEl.value = '';
            chrome.storage.local.remove([STORAGE_KEY_LAST_QUESTION_COPY], () => {
                showQuestionStatus('Текст очищен', 'info');
            });
        });
    }

    if (downloadQuestionLogsBtn) {
        downloadQuestionLogsBtn.addEventListener('click', downloadQuestionScannerLogs);
    }

    if (playAudioBtn) {
        playAudioBtn.addEventListener('click', playAudioToMic);
    }

    if (refreshGradesBtn) {
        refreshGradesBtn.addEventListener('click', refreshGrades);
    }



    function initThemeSettings() {
        const fallbackTheme = 'dark';

        function applyTheme(themeName) {
            const safeTheme = themeName === 'light' ? 'light' : 'dark';
            document.body.dataset.theme = safeTheme;

            if (themeLightBtn) {
                themeLightBtn.classList.toggle('active', safeTheme === 'light');
            }

            if (themeDarkBtn) {
                themeDarkBtn.classList.toggle('active', safeTheme === 'dark');
            }
        }

        chrome.storage.local.get([STORAGE_KEY_THEME], (result) => {
            applyTheme(result && result[STORAGE_KEY_THEME] ? result[STORAGE_KEY_THEME] : fallbackTheme);
        });

        if (settingsToggleBtn && settingsMenuEl) {
            settingsToggleBtn.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                settingsMenuEl.classList.toggle('open');
            });

            settingsMenuEl.addEventListener('click', (event) => {
                event.stopPropagation();
            });

            document.addEventListener('click', () => {
                settingsMenuEl.classList.remove('open');
            });
        }

        [themeLightBtn, themeDarkBtn].forEach((button) => {
            if (!button) {
                return;
            }

            button.addEventListener('click', () => {
                const nextTheme = button.dataset.themeChoice === 'light' ? 'light' : 'dark';
                applyTheme(nextTheme);
                chrome.storage.local.set({ [STORAGE_KEY_THEME]: nextTheme });

                if (settingsMenuEl) {
                    settingsMenuEl.classList.remove('open');
                }
            });
        });
    }

    function initTabs() {
        if (!tabJitsiBtn || !tabQuestionBtn || !tabGradesBtn || !panelJitsiEl || !panelQuestionEl || !panelGradesEl) {
            return;
        }

        tabJitsiBtn.addEventListener('click', () => setActiveTab(TAB_JITSI));
        tabQuestionBtn.addEventListener('click', () => {
            setActiveTab(TAB_QUESTION);
            syncQuestionPanelState(false);
        });

        tabGradesBtn.addEventListener('click', () => {
            setActiveTab(TAB_GRADES);
        });

        setActiveTab(TAB_JITSI);
    }

    function setActiveTab(tabName) {
        const showJitsi = tabName === TAB_JITSI;
        const showQuestion = tabName === TAB_QUESTION;
        const showGrades = tabName === TAB_GRADES;

        tabJitsiBtn.classList.toggle('active', showJitsi);
        tabQuestionBtn.classList.toggle('active', showQuestion);
        tabGradesBtn.classList.toggle('active', showGrades);

        panelJitsiEl.classList.toggle('active', showJitsi);
        panelQuestionEl.classList.toggle('active', showQuestion);
        panelGradesEl.classList.toggle('active', showGrades);
    }

    function isSupportedTabUrl(url) {
        return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
    }

    function getActiveTab(callback) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            callback(tabs && tabs[0] ? tabs[0] : null);
        });
    }

    function shouldRetryInjection(errorMessage) {
        if (!errorMessage) {
            return false;
        }

        return /Receiving end does not exist|Could not establish connection|message port closed before a response was received|не удается установить соединение|Передающий конец|порт сообщения закрыт/i
            .test(errorMessage);
    }

    function injectContentScript(tabId, callback) {
        chrome.scripting.executeScript(
            {
                target: { tabId },
                files: ['content.js']
            },
            () => {
                if (chrome.runtime.lastError) {
                    callback(new Error(chrome.runtime.lastError.message || 'Не удалось внедрить content.js'));
                    return;
                }

                callback(null);
            }
        );
    }

    function sendMessageToActiveTab(message, callback, options = {}) {
        const { tryInject = true } = options;
        popupInfo('sendMessageToActiveTab:start', { action: message && message.action, tryInject });

        getActiveTab((tab) => {
            if (!tab || !tab.id) {
                popupWarn('Нет активной вкладки');
                callback(new Error('Активная вкладка недоступна'));
                return;
            }

            if (!isSupportedTabUrl(tab.url)) {
                popupWarn('Вкладка не поддерживается для messaging', { url: tab.url });
                callback(new Error(ERR_UNSUPPORTED_TAB));
                return;
            }

            chrome.tabs.sendMessage(tab.id, message, (response) => {
                if (!chrome.runtime.lastError) {
                    callback(null, response);
                    return;
                }

                const errorMessage = chrome.runtime.lastError.message || 'Нет связи с контент-скриптом';
                popupWarn('sendMessageToActiveTab:error', { action: message && message.action, errorMessage });
                if (!tryInject || !shouldRetryInjection(errorMessage)) {
                    callback(new Error(errorMessage));
                    return;
                }

                popupInfo('Пробую переинъекцию content.js', { tabId: tab.id });
                injectContentScript(tab.id, (injectError) => {
                    if (injectError) {
                        popupError('Переинъекция не удалась', injectError.message);
                        callback(injectError);
                        return;
                    }

                    chrome.tabs.sendMessage(tab.id, message, (retryResponse) => {
                        if (chrome.runtime.lastError) {
                            popupError('Ошибка после переинъекции', chrome.runtime.lastError.message);
                            callback(new Error(chrome.runtime.lastError.message || 'Нет связи с контент-скриптом'));
                            return;
                        }

                        popupInfo('sendMessageToActiveTab:retry:ok', { action: message && message.action });
                        callback(null, retryResponse);
                    });
                });
            });
        });
    }

    function refreshCurrentName(showConnectedStatus = false) {
        sendMessageToActiveTab({ action: 'getName' }, (error, response) => {
            if (error) {
                currentNameEl.textContent = error.message === ERR_UNSUPPORTED_TAB
                    ? 'Страница не поддерживается'
                    : 'Имя недоступно';

                showMainStatus(
                    error.message === ERR_UNSUPPORTED_TAB
                        ? 'Откройте обычную вкладку сайта для работы с именем'
                        : 'Нет связи с контент-скриптом',
                    'warning'
                );
                return;
            }

            if (response && response.name) {
                currentNameEl.textContent = response.name;
                newNameInput.value = response.name;

                if (showConnectedStatus) {
                    showMainStatus('Связь восстановлена', 'success');
                }
                return;
            }

            currentNameEl.textContent = 'Имя не найдено';
            showMainStatus('Не удалось определить имя', 'warning');
        });
    }

    function applyNameChange() {
        const newName = newNameInput.value.trim();

        if (!newName) {
            showMainStatus('Введите имя перед применением', 'error');
            return;
        }

        setBusy(changeBtn, true, 'Сохраняем...');

        sendMessageToActiveTab({ action: 'setName', name: newName }, (error, response) => {
            setBusy(changeBtn, false, 'Применить имя');

            if (error) {
                showMainStatus('Ошибка связи со страницей', 'error');
                return;
            }

            if (response && response.success) {
                currentNameEl.textContent = newName;
                saveToHistory(newName);
                showMainStatus('Имя успешно изменено', 'success');
            } else {
                showMainStatus('Не удалось изменить имя', 'error');
            }
        });
    }

    function refreshPageInfo() {
        getActiveTab((tab) => {
            if (!tab || !tab.url) {
                pageHostEl.textContent = 'Неизвестно';
                renderKeys([]);
                return;
            }

            try {
                const urlObj = new URL(tab.url);
                pageHostEl.textContent = urlObj.hostname;

                const keys = new Set();

                if (urlObj.pathname && urlObj.pathname.length > 1) {
                    const normalizedPath = urlObj.pathname.replace(/^\/|\/$/g, '');
                    normalizedPath
                        .split(/[./_-]+/)
                        .map((part) => part.trim())
                        .filter((part) => part.length > 2)
                        .forEach((part) => keys.add(part));
                }

                urlObj.hostname
                    .split('.')
                    .slice(0, -2)
                    .map((part) => part.trim())
                    .filter((part) => part.length > 2)
                    .forEach((part) => keys.add(part));

                renderKeys(Array.from(keys));
            } catch (_error) {
                pageHostEl.textContent = 'Ошибка URL';
                renderKeys([]);
            }
        });
    }

    function renderKeys(keys) {
        keysListEl.innerHTML = '';

        if (!keys || keys.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'empty';
            emptyEl.textContent = 'Подсказки не найдены';
            keysListEl.appendChild(emptyEl);
            return;
        }

        keys.forEach((key) => {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.className = 'chip';
            chip.textContent = key;
            chip.title = 'Подставить в поле имени';
            chip.addEventListener('click', () => {
                newNameInput.value = key;
                newNameInput.focus();
                showMainStatus('Ключ вставлен в поле имени', 'info');
            });
            keysListEl.appendChild(chip);
        });
    }

    function reinjectBridge() {
        getActiveTab((tab) => {
            if (!tab || !tab.id) {
                showMainStatus('Нет активной вкладки', 'error');
                return;
            }

            if (!isSupportedTabUrl(tab.url)) {
                showMainStatus('На этой вкладке инъекция недоступна', 'warning');
                return;
            }

            setBusy(injectBtn, true, 'Обновляем...');

            injectContentScript(tab.id, (error) => {
                setBusy(injectBtn, false, 'Обновить связь');

                if (error) {
                    showMainStatus('Не удалось обновить скрипт', 'error');
                    return;
                }

                refreshPageInfo();
                refreshCurrentName(true);
                syncQuestionPanelState(true);
            });
        });
    }

    function setupQuestionPanelDefaults() {
        stopScanPolling();
        setQuestionActionsEnabled(false);
        setScanProgress('Сканирование не запущено', false);
        if (scanBtn) {
            scanBtn.disabled = false;
            scanBtn.textContent = 'Сканировать';
        }
        questionAutoEnabled = false;
        renderQuestionAutoButton();
    }

    function setQuestionActionsEnabled(enabled) {
        if (autoCopyBtn) {
            autoCopyBtn.disabled = !enabled;
        }

        if (copyNowBtn) {
            copyNowBtn.disabled = !enabled;
        }
    }

    function setScanProgress(text, isActive) {
        if (!scanProgressEl) {
            return;
        }

        scanProgressEl.textContent = text;
        scanProgressEl.classList.toggle('is-active', Boolean(isActive));
    }

    function formatMs(ms) {
        const value = Math.max(0, Number(ms) || 0);
        return `${(value / 1000).toFixed(1)}с`;
    }

    function renderScanStatus(status) {
        if (!status) {
            setScanProgress('Сканирование не запущено', false);
            scanActive = false;
            scanReady = false;
            setQuestionActionsEnabled(false);
            return;
        }

        scanActive = Boolean(status.active);
        scanReady = Boolean(status.ready);

        if (scanActive) {
            const elapsed = formatMs(status.elapsedMs);
            const total = formatMs(status.durationMs);
            setScanProgress(`Сканирование: ${elapsed} / ${total}`, true);

            if (scanBtn) {
                scanBtn.disabled = true;
                scanBtn.textContent = 'Сканирование...';
            }
        } else {
            if (scanBtn) {
                scanBtn.disabled = false;
                scanBtn.textContent = 'Сканировать';
            }

            if (scanReady) {
                const elapsed = formatMs(status.elapsedMs);
                const count = Number(status.foundCount || 0);
                setScanProgress(`Готово за ${elapsed}. Найдено вопросов: ${count}`, false);
            } else if (status.lastError) {
                setScanProgress(`Сканирование завершено: ${status.lastError}`, false);
            } else {
                setScanProgress('Сканирование не запущено', false);
            }
        }

        setQuestionActionsEnabled(scanReady);

        if (!scanReady) {
            questionAutoEnabled = false;
        }

        renderQuestionAutoButton();
    }

    function requestScanStatus(callback, options = {}) {
        const { tryInject = true } = options;

        sendMessageToActiveTab({ action: 'getQuestionScanStatus' }, (error, response) => {
            if (error) {
                callback(error);
                return;
            }

            if (!response || !response.success) {
                callback(new Error((response && response.error) || 'Статус сканирования недоступен'));
                return;
            }

            callback(null, response.status || null);
        }, { tryInject });
    }

    function startScanPolling() {
        if (scanPollingTimer) {
            return;
        }

        scanPollingTimer = setInterval(() => {
            requestScanStatus((error, status) => {
                if (error) {
                    stopScanPolling();
                    showQuestionStatus('Не удалось обновить статус сканирования', 'warning');
                    return;
                }

                renderScanStatus(status);
                if (!status || !status.active) {
                    stopScanPolling();
                    if (status && status.ready) {
                        refreshQuestionAutoState(false);
                        const count = Number(status.foundCount || 0);
                        const msg = count > 0
                            ? `Сканирование завершено. Найдено вопросов: ${count}`
                            : 'Сканирование завершено, можно копировать';
                        showQuestionStatus(msg, 'success');
                    } else if (status && status.lastError) {
                        showQuestionStatus(status.lastError, 'warning');
                    }
                }
            }, { tryInject: false });
        }, SCAN_POLL_INTERVAL_MS);
    }

    function stopScanPolling() {
        if (scanPollingTimer) {
            clearInterval(scanPollingTimer);
            scanPollingTimer = null;
        }
    }

    function syncQuestionPanelState(showStatusOnSuccess) {
        requestScanStatus((error, status) => {
            if (error) {
                stopScanPolling();
                setQuestionActionsEnabled(false);
                questionAutoEnabled = false;
                renderQuestionAutoButton();

                if (scanBtn) {
                    scanBtn.disabled = error.message === ERR_UNSUPPORTED_TAB;
                }

                setScanProgress(
                    error.message === ERR_UNSUPPORTED_TAB
                        ? 'Откройте обычную вкладку сайта для сканирования'
                        : 'Нажмите «Сканировать», чтобы подготовить вопрос',
                    false
                );

                if (showStatusOnSuccess) {
                    showQuestionStatus(
                        error.message === ERR_UNSUPPORTED_TAB
                            ? 'На этой вкладке сканирование недоступно'
                            : 'Сканер недоступен, попробуйте снова',
                        'warning'
                    );
                }
                return;
            }

            renderScanStatus(status);

            if (status && status.active) {
                startScanPolling();
            }

            refreshQuestionAutoState(showStatusOnSuccess);
        });
    }

    function startQuestionScan() {
        popupInfo('Пользователь запустил сканирование');
        setBusy(scanBtn, true, 'Запуск...');
        setScanProgress('Сканирование запускается...', true);

        sendMessageToActiveTab({ action: 'startQuestionScan' }, (error, response) => {
            setBusy(scanBtn, false, 'Сканировать');

            if (error) {
                popupError('Ошибка запуска сканирования', error.message);
                setScanProgress('Ошибка запуска сканирования', false);
                showQuestionStatus(error.message, 'error');
                return;
            }

            if (!response || !response.success) {
                popupWarn('Сканирование не запущено', response);
                setScanProgress('Сканирование не запущено', false);
                showQuestionStatus((response && response.error) || 'Не удалось запустить сканирование', 'error');
                return;
            }

            popupInfo('Сканирование успешно запущено', response.status);
            renderScanStatus(response.status || null);
            startScanPolling();
            showQuestionStatus('Сканирование запущено', 'info');
        });
    }

    function refreshQuestionAutoState(showStatusOnSuccess) {
        sendMessageToActiveTab({ action: 'getQuestionAutoCopyState' }, (error, response) => {
            if (error) {
                questionAutoEnabled = false;
                renderQuestionAutoButton();

                if (showStatusOnSuccess) {
                    showQuestionStatus('Не удалось получить режим автокопирования', 'warning');
                }
                return;
            }

            questionAutoEnabled = Boolean(response && response.enabled && scanReady);
            renderQuestionAutoButton();

            if (showStatusOnSuccess) {
                showQuestionStatus('Режим автокопирования синхронизирован', 'success');
            }
        }, { tryInject: false });
    }

    function toggleQuestionAutoCopy() {
        if (!scanReady) {
            showQuestionStatus('Сначала нажмите «Сканировать»', 'warning');
            return;
        }

        const nextValue = !questionAutoEnabled;
        setBusy(autoCopyBtn, true, nextValue ? 'Включаем...' : 'Выключаем...');

        sendMessageToActiveTab({ action: 'setQuestionAutoCopy', enabled: nextValue }, (error, response) => {
            setBusy(autoCopyBtn, false);

            if (error) {
                showQuestionStatus('Нет связи со страницей для автокопирования', 'error');
                return;
            }

            if (!response || !response.success) {
                showQuestionStatus((response && response.error) || 'Не удалось изменить режим', 'error');
                return;
            }

            questionAutoEnabled = Boolean(response.enabled);
            renderQuestionAutoButton();
            showQuestionStatus(
                questionAutoEnabled ? 'Автокопирование включено' : 'Автокопирование выключено',
                'success'
            );
        }, { tryInject: false });
    }

    function renderQuestionAutoButton() {
        if (!autoCopyBtn) {
            return;
        }

        autoCopyBtn.classList.toggle('is-active', questionAutoEnabled);
        autoCopyBtn.textContent = questionAutoEnabled
            ? 'Выключить автокопирование'
            : 'Включить автокопирование';
    }

    function copyQuestionNow() {
        if (!scanReady) {
            showQuestionStatus('Сначала нажмите «Сканировать»', 'warning');
            return;
        }

        setBusy(copyNowBtn, true, 'Копируем...');

        sendMessageToActiveTab({ action: 'copyQuestionNow', force: true }, (error, response) => {
            setBusy(copyNowBtn, false, 'Скопировать сейчас');

            if (error) {
                showQuestionStatus('Не удалось получить вопрос с текущей страницы', 'error');
                return;
            }

            if (!response || !response.success) {
                showQuestionStatus((response && response.error) || 'Копирование не выполнено', 'warning');
                return;
            }

            if (response.text) {
                copiedQuestionEl.value = response.text;
                saveLastCopiedQuestion(response.text);
            }

            const foundCount = Number(response.foundCount || 0);
            const copiedLabel = foundCount > 1
                ? `Скопировано вопросов: ${foundCount}`
                : 'Вопрос скопирован в буфер обмена';

            if (response.copied) {
                showQuestionStatus(copiedLabel, 'success');
            } else {
                showQuestionStatus('Буфер уже содержит этот вопрос', 'info');
            }
        }, { tryInject: false });
    }


    function downloadQuestionScannerLogs() {
        setBusy(downloadQuestionLogsBtn, true, 'Готовим логи...');

        sendMessageToActiveTab({ action: 'getQuestionScannerLogs' }, (error, response) => {
            setBusy(downloadQuestionLogsBtn, false, 'Скачать логи сканера .txt');

            if (error) {
                showQuestionStatus('Не удалось получить логи со страницы', 'error');
                return;
            }

            if (!response || !response.success) {
                showQuestionStatus((response && response.error) || 'Логи недоступны', 'warning');
                return;
            }

            const text = response.text || 'Логи пустые';
            const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            link.href = url;
            link.download = `god-game-question-logs-${stamp}.txt`;
            document.body.appendChild(link);
            link.click();
            link.remove();
            setTimeout(() => URL.revokeObjectURL(url), 1000);

            showQuestionStatus(`Логи скачаны. Записей: ${Number(response.count || 0)}`, 'success');
        }, { tryInject: false });
    }

    function refreshGrades() {
        setBusy(refreshGradesBtn, true, 'Считаем...');
        showGradesStatus('Читаю таблицу журнала на странице...', 'info');

        sendMessageToActiveTab({ action: 'calculateJournalGrades' }, (error, response) => {
            setBusy(refreshGradesBtn, false, 'Посчитать оценки');

            if (error) {
                renderGradesResult(null);
                showGradesStatus(error.message === ERR_UNSUPPORTED_TAB ? 'Откройте обычную страницу журнала' : 'Нет связи со страницей', 'error');
                return;
            }

            if (!response || !response.success) {
                renderGradesResult(null);
                showGradesStatus((response && response.error) || 'Не удалось прочитать оценки', 'warning');
                return;
            }

            renderGradesResult(response);
            showGradesStatus('Итоговые оценки рассчитаны', 'success');
        });
    }

    function renderGradesResult(result) {
        if (!gradesSummaryEl || !gradesListEl) return;
        gradesListEl.innerHTML = '';

        if (!result || !Array.isArray(result.subjects) || result.subjects.length === 0) {
            gradesSummaryEl.textContent = 'Оценки не найдены';
            const emptyEl = document.createElement('div');
            emptyEl.className = 'empty';
            emptyEl.textContent = 'Откройте журнал и нажмите «Посчитать оценки»';
            gradesListEl.appendChild(emptyEl);
            return;
        }

        gradesSummaryEl.textContent = `Найдено предметов: ${result.totalSubjects}. С оценками: ${result.subjectsWithMarks}. Формула: среднее арифметическое.`;

        result.subjects.forEach((item) => {
            const card = document.createElement('div');
            card.className = 'grade-item';

            const head = document.createElement('div');
            head.className = 'grade-head';

            const subjectEl = document.createElement('div');
            subjectEl.className = 'grade-subject';
            subjectEl.textContent = item.subject || 'Без названия';

            const finalEl = document.createElement('div');
            finalEl.className = 'grade-final';
            finalEl.textContent = item.finalMark || '—';
            finalEl.title = 'Предполагаемая итоговая оценка';

            head.appendChild(subjectEl);
            head.appendChild(finalEl);

            const metaEl = document.createElement('div');
            metaEl.className = 'grade-meta';
            metaEl.textContent = item.marksCount > 0
                ? `Средний балл: ${Number(item.average).toFixed(2)} · Оценок: ${item.marksCount}`
                : 'Оценок для расчёта нет';

            const marksEl = document.createElement('div');
            marksEl.className = 'grade-marks';
            marksEl.textContent = item.marksCount > 0 ? `Оценки: ${item.marks.join(', ')}` : 'Оценки: —';

            card.appendChild(head);
            card.appendChild(metaEl);
            card.appendChild(marksEl);
            gradesListEl.appendChild(card);
        });
    }

    function showGradesStatus(message, type = 'info') {
        if (!gradesStatusEl) return;
        gradesStatusEl.textContent = message;
        gradesStatusEl.className = `status show is-${type}`;

        if (gradesStatusTimer) clearTimeout(gradesStatusTimer);

        gradesStatusTimer = setTimeout(() => {
            gradesStatusEl.className = 'status';
            gradesStatusEl.textContent = '';
        }, 3500);
    }

    function setBusy(button, isBusy, busyText) {
        if (!button) {
            return;
        }

        if (!button.dataset.defaultText) {
            button.dataset.defaultText = button.textContent;
        }

        button.disabled = isBusy;
        button.textContent = isBusy ? busyText : button.dataset.defaultText;
    }

    function saveToHistory(name) {
        chrome.storage.local.get([STORAGE_KEY_HISTORY], (result) => {
            const history = Array.isArray(result[STORAGE_KEY_HISTORY]) ? result[STORAGE_KEY_HISTORY] : [];

            const cleanHistory = history.filter((item) => item && item.name && item.name !== name);
            cleanHistory.unshift({ name, date: new Date().toISOString() });

            const nextHistory = cleanHistory.slice(0, MAX_HISTORY_ITEMS);
            chrome.storage.local.set({ [STORAGE_KEY_HISTORY]: nextHistory }, () => {
                renderHistory(nextHistory);
            });
        });
    }

    function loadHistory() {
        chrome.storage.local.get([STORAGE_KEY_HISTORY], (result) => {
            const history = Array.isArray(result[STORAGE_KEY_HISTORY]) ? result[STORAGE_KEY_HISTORY] : [];
            renderHistory(history);
        });
    }

    function renderHistory(history) {
        historyListEl.innerHTML = '';

        if (!history || history.length === 0) {
            const emptyEl = document.createElement('div');
            emptyEl.className = 'empty';
            emptyEl.textContent = 'История пока пустая';
            historyListEl.appendChild(emptyEl);
            return;
        }

        history.forEach((item) => {
            const entry = document.createElement('button');
            entry.type = 'button';
            entry.className = 'history-item';

            const nameEl = document.createElement('span');
            nameEl.className = 'history-name';
            nameEl.textContent = item.name || 'Без имени';

            const dateEl = document.createElement('span');
            dateEl.className = 'history-date';
            dateEl.textContent = formatDate(item.date);

            entry.appendChild(nameEl);
            entry.appendChild(dateEl);
            entry.addEventListener('click', () => {
                newNameInput.value = item.name || '';
                newNameInput.focus();
                showMainStatus('Имя из истории подставлено', 'info');
            });

            historyListEl.appendChild(entry);
        });
    }

    function loadLastCopiedQuestion() {
        chrome.storage.local.get([STORAGE_KEY_LAST_QUESTION_COPY], (result) => {
            if (result && typeof result[STORAGE_KEY_LAST_QUESTION_COPY] === 'string') {
                copiedQuestionEl.value = result[STORAGE_KEY_LAST_QUESTION_COPY];
            }
        });
    }

    function saveLastCopiedQuestion(text) {
        chrome.storage.local.set({ [STORAGE_KEY_LAST_QUESTION_COPY]: text });
    }

    function formatDate(rawDate) {
        if (!rawDate) {
            return 'Без даты';
        }

        const parsed = new Date(rawDate);
        if (Number.isNaN(parsed.getTime())) {
            return String(rawDate);
        }

        return parsed.toLocaleString('ru-RU', {
            day: '2-digit',
            month: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    function showMainStatus(message, type = 'info') {
        if (!statusEl) {
            return;
        }

        statusEl.textContent = message;
        statusEl.className = `status show is-${type}`;

        if (mainStatusTimer) {
            clearTimeout(mainStatusTimer);
        }

        mainStatusTimer = setTimeout(() => {
            statusEl.className = 'status';
            statusEl.textContent = '';
        }, 3200);
    }

    function showQuestionStatus(message, type = 'info') {
        if (!questionStatusEl) {
            return;
        }

        questionStatusEl.textContent = message;
        questionStatusEl.className = `status show is-${type}`;

        if (questionStatusTimer) {
            clearTimeout(questionStatusTimer);
        }

        questionStatusTimer = setTimeout(() => {
            questionStatusEl.className = 'status';
            questionStatusEl.textContent = '';
        }, 3500);
    }

    function showAudioStatus(message, type = 'info') {
        if (!audioStatusEl) {
            return;
        }

        audioStatusEl.textContent = message;
        audioStatusEl.className = `status show is-${type}`;

        setTimeout(() => {
            audioStatusEl.className = 'status';
            audioStatusEl.textContent = '';
        }, 3000);
    }

    function playAudioToMic() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            showAudioStatus('Ваш браузер не поддерживает доступ к микрофону', 'error');
            return;
        }

        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);

                oscillator.frequency.setValueAtTime(440, audioContext.currentTime); // A4 note
                oscillator.type = 'sine';

                gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);

                oscillator.start();
                setTimeout(() => {
                    oscillator.stop();
                    stream.getTracks().forEach(track => track.stop());
                    showAudioStatus('Звук воспроизведен', 'success');
                }, 2000);

                showAudioStatus('Воспроизведение звука...', 'info');
            })
            .catch(err => {
                console.error('Ошибка доступа к микрофону:', err);
                showAudioStatus('Ошибка доступа к микрофону: ' + err.message, 'error');
            });
    }
});
