/**
 * Nebulix Engine - Ядро генерации изображений
 * Использует Transformers.js + WebGPU для локальной генерации
 * @module nebula-engine
 */

import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/dist/transformers.min.js';
import * as idbCache from './indexeddb-cache.js';
import { updateProgress, updateStatus, showErrorMessage, showGenerationProcess, setGenerationTimer, updateImageMetadata, showGeneratedImage } from './ui-controller.js';
import { detectWebGPU, measurePerformance, sleep, logError, generateUUID } from './utils.js';

// Настройка окружения Transformers.js
env.allowLocalModels = false;
env.useBrowserCache = false; // Управляем кэшем через IndexedDB сами
env.backends.onnx.preferredBackend = 'webgpu';

// Конфигурация модели
let MODEL_ID = 'Xenova/stable-diffusion-turbo';
let config = null;
let generator = null;
let generationInProgress = false;
let cancelRequested = false;
let currentController = null;

// Загрузка конфигурации
async function loadConfig() {
  try {
    const response = await fetch('./config.json');
    config = await response.json();
    if (config.model) MODEL_ID = config.model;
  } catch (e) {
    console.warn('Конфиг не загружен, используем значения по умолчанию');
    config = {
      defaultParams: { width: 512, height: 512, steps: 4, guidance: 0.0, seed: null },
      maxResolution: 4096,
      indexedDBName: 'NebulixModelCache',
      maxRetries: 3,
      progressUpdateInterval: 200
    };
  }
}

// Проверка поддержки WebGPU
function checkWebGPUSupport() {
  if (!detectWebGPU()) {
    showErrorMessage('WebGPU не поддерживается. Используйте Chrome 113+ или Edge 113+.');
    return false;
  }
  return true;
}

// Инициализация модели с кэшированием
async function initializeModel(progressCallback) {
  if (!checkWebGPUSupport()) {
    throw new Error('WebGPU not supported');
  }
  
  await loadConfig();
  
  // Проверяем, есть ли модель в IndexedDB
  const isCached = await idbCache.isModelCached(MODEL_ID);
  
  if (!isCached) {
    updateStatus('Загрузка модели ИИ (это займёт несколько минут)...');
  } else {
    updateStatus('Загрузка модели из кэша...');
  }
  
  // Создаем воркер для фоновой загрузки
  const worker = new Worker('./model-loader.worker.js', { type: 'module' });
  
  return new Promise((resolve, reject) => {
    worker.onmessage = async (e) => {
      const { type, progress, message, error } = e.data;
      
      switch (type) {
        case 'progress':
          if (progressCallback) progressCallback(progress);
          updateProgress(progress);
          break;
        case 'loaded':
          updateStatus('Модель загружена. Инициализация WebGPU...');
          try {
            // Инициализируем пайплайн в основном потоке
            generator = await pipeline('text-to-image', MODEL_ID, {
              device: 'webgpu',
              dtype: 'fp16',
              progress_callback: (p) => {
                if (p.status === 'progress') {
                  const percent = Math.round((p.loaded / p.total) * 100);
                  updateProgress(percent);
                }
              }
            });
            updateStatus('Готов к генерации');
            updateProgress(100);
            resolve(generator);
          } catch (err) {
            reject(err);
          }
          break;
        case 'error':
          logError(error, 'ModelLoaderWorker');
          reject(new Error(error));
          break;
        case 'cached_progress':
          // Прогресс восстановления из кэша
          updateProgress(progress);
          break;
        default:
          console.warn('Неизвестное сообщение от воркера:', type);
      }
    };
    
    worker.onerror = (error) => {
      logError(error, 'WorkerError');
      reject(error);
    };
    
    // Запускаем загрузку в воркере
    worker.postMessage({
      type: 'load',
      modelId: MODEL_ID,
      config: config
    });
  });
}

// Генерация изображения
async function generateImage(prompt, options = {}) {
  if (!generator) {
    throw new Error('Модель не инициализирована');
  }
  
  if (generationInProgress) {
    throw new Error('Генерация уже выполняется');
  }
  
  // Валидация промпта
  if (!prompt || prompt.trim().length < 3) {
    throw new Error('Промпт слишком короткий (минимум 3 символа)');
  }
  
  generationInProgress = true;
  cancelRequested = false;
  currentController = new AbortController();
  
  const startTime = performance.now();
  setGenerationTimer(startTime);
  
  // Параметры по умолчанию
  const defaultParams = config.defaultParams || { width: 512, height: 512, steps: 4, guidance: 0.0, seed: null };
  const params = {
    width: options.width || defaultParams.width,
    height: options.height || defaultParams.height,
    num_inference_steps: options.steps || defaultParams.steps,
    guidance_scale: options.guidance !== undefined ? options.guidance : defaultParams.guidance,
    seed: options.seed !== undefined && options.seed !== null ? options.seed : Math.floor(Math.random() * 1000000)
  };
  
  // Проверка максимального разрешения
  const maxRes = config.maxResolution || 4096;
  if (params.width > maxRes || params.height > maxRes) {
    params.width = Math.min(params.width, maxRes);
    params.height = Math.min(params.height, maxRes);
    console.warn('Разрешение ограничено до', maxRes);
  }
  
  updateStatus(`Генерация изображения... (${params.width}x${params.height})`);
  showGenerationProcess(true);
  
  try {
    // Генерация базового изображения (512x512)
    const result = await generator(prompt, {
      ...params,
      width: 512,
      height: 512,
      callback_function: (step, timestep, latents) => {
        if (cancelRequested) {
          currentController.abort();
        }
        // Обновление UI о прогрессе шагов
        const progressPercent = (step / params.num_inference_steps) * 100;
        updateProgress(progressPercent);
        updateStatus(`Шаг ${step}/${params.num_inference_steps}...`);
      },
      signal: currentController.signal
    });
    
    if (cancelRequested) {
      throw new Error('Генерация отменена пользователем');
    }
    
    // Получаем изображение как Blob
    let imageBlob = await result.toBlob();
    
    // Апскейлинг до целевого разрешения, если требуется
    if (params.width > 512 || params.height > 512) {
      updateStatus('Масштабирование до 4K...');
      imageBlob = await upscaleImage(imageBlob, params.width, params.height, options.sharpen !== false);
    }
    
    const endTime = performance.now();
    const duration = (endTime - startTime) / 1000;
    
    // Метаданные для UI
    const metadata = {
      resolution: `${params.width}x${params.height}`,
      seed: params.seed,
      steps: params.num_inference_steps,
      time: duration.toFixed(1)
    };
    
    updateImageMetadata(metadata);
    
    // Отображаем результат
    await showGeneratedImage(imageBlob, prompt, duration);
    
    updateStatus('Готово');
    updateProgress(100);
    
    return imageBlob;
    
  } catch (error) {
    logError(error, 'Generation');
    if (error.name === 'AbortError' || cancelRequested) {
      updateStatus('Генерация отменена');
      showErrorMessage('Генерация была отменена.');
    } else {
      showErrorMessage(`Ошибка генерации: ${error.message}`);
      updateStatus('Ошибка генерации');
    }
    throw error;
  } finally {
    generationInProgress = false;
    showGenerationProcess(false);
    currentController = null;
  }
}

// Функция апскейлинга изображения через Canvas
async function upscaleImage(blob, targetWidth, targetHeight, sharpen = true) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d', { alpha: true, willReadFrequently: false });
      
      // Билинейная интерполяция (по умолчанию)
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      
      // Улучшение резкости (простое увеличение контраста)
      if (sharpen) {
        const imageData = ctx.getImageData(0, 0, targetWidth, targetHeight);
        const data = imageData.data;
        const factor = 1.2; // коэффициент резкости
        for (let i = 0; i < data.length; i += 4) {
          // Применяем небольшой unsharp mask эффект через контраст
          data[i] = Math.min(255, Math.max(0, data[i] * factor - 128 * (factor - 1)));
          data[i+1] = Math.min(255, Math.max(0, data[i+1] * factor - 128 * (factor - 1)));
          data[i+2] = Math.min(255, Math.max(0, data[i+2] * factor - 128 * (factor - 1)));
        }
        ctx.putImageData(imageData, 0, 0);
      }
      
      canvas.toBlob((upscaledBlob) => {
        resolve(upscaledBlob);
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(blob);
  });
}

// Отмена текущей генерации
function cancelGeneration() {
  if (generationInProgress) {
    cancelRequested = true;
    if (currentController) {
      currentController.abort();
    }
    updateStatus('Отмена генерации...');
  }
}

// Получить статус модели
function getModelStatus() {
  return {
    loaded: generator !== null,
    generating: generationInProgress,
    modelId: MODEL_ID
  };
}

// Экспорт публичного API
export {
  initializeModel,
  generateImage,
  cancelGeneration,
  getModelStatus,
  checkWebGPUSupport
};

// Инициализация при импорте (не автоматическая, вызывается через UI контроллер)
