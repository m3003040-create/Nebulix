/**
 * UI Controller - Управление интерфейсом Nebulix
 * @module ui-controller
 */

import { generateImage, initializeModel, cancelGeneration, getModelStatus, checkWebGPUSupport } from './nebula-engine.js';
import { formatBytes, formatTime, debounce, sanitizeInput, copyToClipboard, downloadBlob, logError } from './utils.js';

// DOM элементы
let elements = {};
let config = {};
let deferredPrompt = null;
let currentPrompt = '';
let generationStartTime = 0;
let timerInterval = null;

// Инициализация UI
function initApp(appConfig) {
  config = appConfig;
  cacheElements();
  setupEventListeners();
  checkWebGPUAndInit();
  setupPWAInstall();
  setupAutoResize();
  updateStatus('Инициализация...');
  
  // Обработка истории (виртуализация)
  setupChatVirtualization();
}

function cacheElements() {
  elements = {
    chatContainer: document.getElementById('chat-container'),
    promptInput: document.getElementById('prompt-input'),
    generateBtn: document.getElementById('generate-btn'),
    statusMessage: document.getElementById('status-message'),
    modelProgress: document.getElementById('model-progress'),
    imageResultContainer: document.getElementById('image-result-container'),
    generatedCanvas: document.getElementById('generated-canvas'),
    generationOverlay: document.getElementById('generation-overlay'),
    metadataResolution: document.getElementById('metadata-resolution'),
    metadataSeed: document.getElementById('metadata-seed'),
    metadataSteps: document.getElementById('metadata-steps'),
    metadataTime: document.getElementById('metadata-time'),
    downloadBtn: document.getElementById('download-image-btn'),
    copyPromptBtn: document.getElementById('copy-prompt-btn'),
    clearChatBtn: document.getElementById('clear-chat-btn'),
    installPwaBtn: document.getElementById('install-pwa-btn'),
    settingsBtn: document.getElementById('settings-btn'),
    toggleAdvancedBtn: document.getElementById('toggle-advanced-btn'),
    advancedOptions: document.getElementById('advanced-options'),
    widthInput: document.getElementById('width-input'),
    heightInput: document.getElementById('height-input'),
    stepsInput: document.getElementById('steps-input'),
    stepsValue: document.getElementById('steps-value'),
    seedInput: document.getElementById('seed-input'),
    guidanceCheckbox: document.getElementById('guidance-checkbox'),
    sharpenCheckbox: document.getElementById('sharpen-checkbox')
  };
}

function setupEventListeners() {
  // Генерация
  elements.generateBtn.addEventListener('click', handleGenerate);
  elements.promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!elements.generateBtn.disabled) {
        handleGenerate();
      }
    }
  });
  
  // Очистка чата
  elements.clearChatBtn.addEventListener('click', clearChat);
  
  // Скачивание и копирование
  elements.downloadBtn.addEventListener('click', downloadCurrentImage);
  elements.copyPromptBtn.addEventListener('click', copyCurrentPrompt);
  
  // Расширенные настройки
  elements.toggleAdvancedBtn.addEventListener('click', toggleAdvancedOptions);
  elements.stepsInput.addEventListener('input', () => {
    elements.stepsValue.textContent = elements.stepsInput.value;
  });
  
  // Валидация разрешения
  elements.widthInput.addEventListener('change', validateResolution);
  elements.heightInput.addEventListener('change', validateResolution);
  
  // Настройки (пока заглушка)
  elements.settingsBtn.addEventListener('click', () => {
    updateStatus('Настройки пока недоступны', 'info');
  });
}

// Проверка WebGPU и инициализация модели
async function checkWebGPUAndInit() {
  const webgpuSupported = checkWebGPUSupport();
  if (!webgpuSupported) {
    updateStatus('WebGPU не поддерживается. Используйте Chrome 113+', 'error');
    elements.generateBtn.disabled = true;
    return;
  }
  
  try {
    updateStatus('Загрузка модели...');
    showProgress(true);
    
    await initializeModel((progress) => {
      updateProgress(progress);
      if (progress === 100) {
        elements.generateBtn.disabled = false;
        updateStatus('Готов к работе');
      } else {
        updateStatus(`Загрузка модели: ${progress}%`);
      }
    });
    
    showProgress(false);
  } catch (error) {
    logError(error, 'Init');
    updateStatus('Ошибка загрузки модели', 'error');
    showErrorMessage('Не удалось загрузить модель. Проверьте соединение и попробуйте снова.');
  }
}

// Обработчик генерации
async function handleGenerate() {
  const prompt = elements.promptInput.value.trim();
  if (!prompt) {
    updateStatus('Введите описание изображения', 'error');
    return;
  }
  
  // Санитизация
  const sanitized = sanitizeInput(prompt);
  if (sanitized.length < 3) {
    updateStatus('Слишком короткий промпт', 'error');
    return;
  }
  
  // Добавляем сообщение пользователя
  addUserMessage(sanitized);
  currentPrompt = sanitized;
  elements.promptInput.value = '';
  
  // Блокируем интерфейс
  setUIEnabled(false);
  elements.imageResultContainer.style.display = 'none';
  
  // Параметры генерации
  const options = {
    width: parseInt(elements.widthInput.value, 10),
    height: parseInt(elements.heightInput.value, 10),
    steps: parseInt(elements.stepsInput.value, 10),
    guidance: elements.guidanceCheckbox.checked ? 7.5 : 0.0,
    seed: elements.seedInput.value ? parseInt(elements.seedInput.value, 10) : null,
    sharpen: elements.sharpenCheckbox.checked
  };
  
  try {
    const blob = await generateImage(sanitized, options);
    // Изображение уже отображено через showGeneratedImage внутри generateImage
    addAIMessage(`Изображение сгенерировано за ${getGenerationTime()}с`, false);
  } catch (error) {
    addAIMessage(`Ошибка: ${error.message}`, false);
  } finally {
    setUIEnabled(true);
    showProgress(false);
  }
}

// Управление UI состоянием
function setUIEnabled(enabled) {
  elements.generateBtn.disabled = !enabled;
  elements.promptInput.disabled = !enabled;
  if (!enabled) {
    elements.generateBtn.innerHTML = `<svg class="btn-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 6V12L16 14"/></svg>`;
  } else {
    elements.generateBtn.innerHTML = `<svg class="btn-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"/></svg>`;
  }
}

function updateStatus(message, type = 'info') {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = 'status-message';
  if (type === 'error') {
    elements.statusMessage.classList.add('error-message');
  } else {
    elements.statusMessage.classList.remove('error-message');
  }
}

function updateProgress(percent) {
  elements.modelProgress.value = percent;
  elements.modelProgress.style.display = percent > 0 && percent < 100 ? 'block' : 'none';
}

function showProgress(show) {
  elements.modelProgress.style.display = show ? 'block' : 'none';
}

function showGeneratedImage(blob, prompt, duration) {
  const url = URL.createObjectURL(blob);
  const ctx = elements.generatedCanvas.getContext('2d');
  const img = new Image();
  img.onload = () => {
    elements.generatedCanvas.width = img.width;
    elements.generatedCanvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    
    elements.imageResultContainer.style.display = 'block';
    elements.generationOverlay.style.display = 'none';
    
    // Сохраняем blob для скачивания
    elements.currentImageBlob = blob;
    elements.currentPrompt = prompt;
  };
  img.src = url;
  
  // Метаданные обновляются в nebula-engine
}

function showGenerationProcess(active) {
  elements.generationOverlay.style.display = active ? 'flex' : 'none';
}

function setGenerationTimer(startTime) {
  generationStartTime = startTime;
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const elapsed = (performance.now() - generationStartTime) / 1000;
    elements.metadataTime.textContent = elapsed.toFixed(1) + 'с';
  }, 100);
}

function getGenerationTime() {
  return ((performance.now() - generationStartTime) / 1000).toFixed(1);
}

function updateImageMetadata(metadata) {
  elements.metadataResolution.textContent = metadata.resolution;
  elements.metadataSeed.textContent = `Seed: ${metadata.seed}`;
  elements.metadataSteps.textContent = `Шаги: ${metadata.steps}/${metadata.steps}`;
  elements.metadataTime.textContent = metadata.time + 'с';
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function addUserMessage(text) {
  const template = document.getElementById('message-user-template');
  const clone = template.content.cloneNode(true);
  clone.querySelector('.message-content').textContent = text;
  elements.chatContainer.appendChild(clone);
  scrollChatToBottom();
}

function addAIMessage(text, isGenerating = false) {
  const template = document.getElementById('message-ai-template');
  const clone = template.content.cloneNode(true);
  const contentDiv = clone.querySelector('.message-content');
  
  if (isGenerating) {
    // Анимация печати
    animateTyping(contentDiv, text);
  } else {
    contentDiv.textContent = text;
  }
  
  elements.chatContainer.appendChild(clone);
  scrollChatToBottom();
}

function animateTyping(element, text, speed = 30) {
  let i = 0;
  element.textContent = '';
  const interval = setInterval(() => {
    if (i < text.length) {
      element.textContent += text.charAt(i);
      i++;
      scrollChatToBottom();
    } else {
      clearInterval(interval);
    }
  }, speed);
}

function clearChat() {
  while (elements.chatContainer.children.length > 1) {
    elements.chatContainer.removeChild(elements.chatContainer.lastChild);
  }
}

function scrollChatToBottom() {
  elements.chatContainer.scrollTop = elements.chatContainer.scrollHeight;
}

function toggleAdvancedOptions() {
  const expanded = elements.toggleAdvancedBtn.getAttribute('aria-expanded') === 'true';
  elements.toggleAdvancedBtn.setAttribute('aria-expanded', !expanded);
  elements.advancedOptions.style.display = expanded ? 'none' : 'grid';
  elements.advancedOptions.setAttribute('aria-hidden', expanded);
}

function validateResolution() {
  const maxRes = config.maxResolution || 4096;
  if (elements.widthInput.value > maxRes) elements.widthInput.value = maxRes;
  if (elements.heightInput.value > maxRes) elements.heightInput.value = maxRes;
}

function downloadCurrentImage() {
  if (elements.currentImageBlob) {
    const filename = `nebulix-${Date.now()}.png`;
    downloadBlob(elements.currentImageBlob, filename);
  }
}

function copyCurrentPrompt() {
  if (currentPrompt) {
    copyToClipboard(currentPrompt);
    updateStatus('Промпт скопирован', 'info');
  }
}

function setupPWAInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    elements.installPwaBtn.style.display = 'flex';
  });
  
  elements.installPwaBtn.addEventListener('click', async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        elements.installPwaBtn.style.display = 'none';
      }
      deferredPrompt = null;
    }
  });
}

function setupAutoResize() {
  elements.promptInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
  });
}

function setupChatVirtualization() {
  // Простая виртуализация: ограничиваем количество сообщений
  const MAX_VISIBLE_MESSAGES = 50;
  const observer = new MutationObserver(() => {
    if (elements.chatContainer.children.length > MAX_VISIBLE_MESSAGES) {
      const removeCount = elements.chatContainer.children.length - MAX_VISIBLE_MESSAGES;
      for (let i = 0; i < removeCount; i++) {
        if (elements.chatContainer.children.length > 1) {
          elements.chatContainer.removeChild(elements.chatContainer.children[1]);
        }
      }
    }
  });
  observer.observe(elements.chatContainer, { childList: true });
}

function showErrorMessage(error) {
  updateStatus(error, 'error');
  // Можно добавить тост уведомление
  console.error(error);
}

// Экспорт функций для использования в других модулях
export {
  initApp,
  updateStatus,
  updateProgress,
  showGeneratedImage,
  showGenerationProcess,
  setGenerationTimer,
  updateImageMetadata,
  addUserMessage,
  addAIMessage,
  showErrorMessage,
  setUIEnabled,
  showProgress
};
