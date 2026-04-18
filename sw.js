/**
 * Service Worker для Nebulix
 * Обеспечивает офлайн-работу и кэширование ресурсов
 */

const CACHE_NAME = 'nebulix-cache-v1.0.0';
const STATIC_ASSETS = [
  './',
  './index.html',
  './nebula-style.css',
  './nebula-engine.js',
  './model-loader.worker.js',
  './ui-controller.js',
  './indexeddb-cache.js',
  './utils.js',
  './config.json',
  './manifest.webmanifest',
  'https://fonts.googleapis.com/css2?family=Inter:wght@200;300;400;500;600&display=swap',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/dist/transformers.min.js'
];

// Установка SW и кэширование статики
self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Кэширование статических ресурсов');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => self.skipWaiting())
  );
});

// Активация и очистка старых кэшей
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => {
          return name !== CACHE_NAME;
        }).map((name) => {
          console.log('[SW] Удаление старого кэша:', name);
          return caches.delete(name);
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Стратегия кэширования: Cache First для статики, Network First для API (если будут)
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Не кэшируем запросы к chrome-extension
  if (url.protocol === 'chrome-extension:') {
    return;
  }
  
  // Для запросов к моделям Hugging Face (CDN) используем стратегию Stale-While-Revalidate
  if (url.hostname.includes('huggingface.co') || url.hostname.includes('cdn.jsdelivr.net')) {
    event.respondWith(
      caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((cachedResponse) => {
          const fetchPromise = fetch(event.request).then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              cache.put(event.request, networkResponse.clone());
            }
            return networkResponse;
          }).catch(() => {
            // Если сеть недоступна, возвращаем кэш
            return cachedResponse;
          });
          
          // Возвращаем кэш немедленно, если есть, иначе ждем сеть
          return cachedResponse || fetchPromise;
        });
      })
    );
    return;
  }
  
  // Для статических ресурсов (нашего приложения) - Cache First
  if (STATIC_ASSETS.some(asset => event.request.url.includes(asset.split('/').pop()) || event.request.url.endsWith('/'))) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        
        return fetch(event.request).then((response) => {
          // Кэшируем только успешные ответы
          if (response && response.status === 200) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        }).catch(() => {
          // Офлайн fallback для HTML
          if (event.request.headers.get('accept').includes('text/html')) {
            return caches.match('./index.html');
          }
        });
      })
    );
    return;
  }
  
  // Для всех остальных запросов - Network First
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone);
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});

// Обработка сообщений от клиента
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
