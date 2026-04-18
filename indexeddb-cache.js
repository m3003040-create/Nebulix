/**
 * Модуль управления кэшем модели в IndexedDB
 * @module indexeddb-cache
 */

const DB_NAME = 'NebulixModelCache';
const DB_VERSION = 1;
const STORE_NAME = 'modelChunks';

// Открытие базы данных
async function openCache() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: ['modelId', 'chunkIndex'] });
        store.createIndex('by_model', 'modelId', { unique: false });
      }
    };
  });
}

// Сохранение чанка модели
async function saveModelChunk(modelId, chunkIndex, data) {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put({ modelId, chunkIndex, data });
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
    
    transaction.oncomplete = () => db.close();
  });
}

// Получение чанка модели
async function getModelChunk(modelId, chunkIndex) {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get([modelId, chunkIndex]);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result?.data || null);
    
    transaction.oncomplete = () => db.close();
  });
}

// Проверка наличия полной модели в кэше
async function isModelCached(modelId) {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const index = store.index('by_model');
    const request = index.count(modelId);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      // Если есть хотя бы один чанк, считаем, что модель закэширована
      // В реальном приложении нужно проверять целостность
      resolve(request.result > 0);
    };
    
    transaction.oncomplete = () => db.close();
  });
}

// Очистка кэша модели
async function clearModelCache(modelId = null) {
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
    let request;
    if (modelId) {
      const index = store.index('by_model');
      request = index.openCursor(IDBKeyRange.only(modelId));
      request.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
    } else {
      request = store.clear();
    }
    
    transaction.onerror = () => reject(transaction.error);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
  });
}

// Получение размера занятого пространства (приблизительно)
async function getCacheSize() {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return estimate.usage || 0;
  }
  
  // Fallback: подсчет вручную
  const db = await openCache();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    const request = store.openCursor();
    
    let totalSize = 0;
    request.onerror = () => reject(request.error);
    request.onsuccess = (event) => {
      const cursor = event.target.result;
      if (cursor) {
        const data = cursor.value.data;
        if (data instanceof Blob) {
          totalSize += data.size;
        } else if (data && data.byteLength) {
          totalSize += data.byteLength;
        } else if (typeof data === 'string') {
          totalSize += data.length * 2; // UTF-16
        }
        cursor.continue();
      } else {
        db.close();
        resolve(totalSize);
      }
    };
  });
}

// Проверка доступной квоты
async function checkQuota(requiredBytes) {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    const available = estimate.quota - estimate.usage;
    return available > requiredBytes;
  }
  // Если API недоступен, предполагаем, что места достаточно
  return true;
}

export {
  openCache,
  saveModelChunk,
  getModelChunk,
  isModelCached,
  clearModelCache,
  getCacheSize,
  checkQuota
};
