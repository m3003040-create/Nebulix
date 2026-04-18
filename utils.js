/**
 * Вспомогательные утилиты для Nebulix
 * @module utils
 */

// Дебаунс
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// Троттлинг
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Форматирование байтов
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Байт';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Байт', 'КБ', 'МБ', 'ГБ', 'ТБ'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Форматирование времени
function formatTime(seconds) {
  if (seconds < 60) return `${seconds.toFixed(1)}с`;
  const mins = Math.floor(seconds / 60);
  const secs = (seconds % 60).toFixed(0);
  return `${mins}м ${secs}с`;
}

// Генерация UUID
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// Валидация промпта
function validatePrompt(prompt) {
  if (!prompt || typeof prompt !== 'string') return false;
  const trimmed = prompt.trim();
  return trimmed.length >= 3 && trimmed.length <= 500;
}

// Санитизация ввода
function sanitizeInput(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Проверка поддержки WebGPU
function detectWebGPU() {
  return 'gpu' in navigator;
}

// Информация о браузере
function getBrowserInfo() {
  const ua = navigator.userAgent;
  let name = 'Unknown';
  if (ua.includes('Chrome')) name = 'Chrome';
  else if (ua.includes('Firefox')) name = 'Firefox';
  else if (ua.includes('Safari')) name = 'Safari';
  else if (ua.includes('Edge')) name = 'Edge';
  return { name, version: ua.match(/(Chrome|Firefox|Safari|Edge)\/(\d+)/)?.[2] || '?' };
}

// Логирование ошибок
function logError(error, context = 'General') {
  console.error(`[Nebulix:${context}]`, error);
  // Можно отправить в аналитику, но мы локальные
}

// Скачивание Blob
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Копирование в буфер обмена
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    // Fallback
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    return true;
  }
}

// Загрузка конфигурации
async function parseConfig() {
  try {
    const response = await fetch('./config.json');
    if (!response.ok) throw new Error('Failed to load config');
    return await response.json();
  } catch (e) {
    console.warn('Using default config');
    return {
      model: 'Xenova/stable-diffusion-turbo',
      defaultParams: { width: 512, height: 512, steps: 4, guidance: 0.0, seed: null },
      maxResolution: 4096,
      indexedDBName: 'NebulixModelCache',
      limits: { maxPromptLength: 500, minPromptLength: 3 }
    };
  }
}

// Замер производительности
async function measurePerformance(fn) {
  const start = performance.now();
  await fn();
  return performance.now() - start;
}

// Проверка онлайн статуса
function isOnline() {
  return navigator.onLine;
}

// Асинхронная задержка
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Экспорт всех функций
export {
  debounce,
  throttle,
  formatBytes,
  formatTime,
  generateUUID,
  validatePrompt,
  sanitizeInput,
  detectWebGPU,
  getBrowserInfo,
  logError,
  downloadBlob,
  copyToClipboard,
  parseConfig,
  measurePerformance,
  isOnline,
  sleep
};
