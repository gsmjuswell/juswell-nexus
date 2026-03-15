// ═══════════════════════════════════════════════════════════
// JUSWELL NEXUS — sw.js  (Service Worker PWA)
// Cache des assets statiques + mode hors-ligne
// api.php remplacé par Firebase → jamais mis en cache
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = "juswell-nexus-v1";

// Assets statiques à mettre en cache
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&display=swap"
];

// ── INSTALL : pré-cache des assets ──────────────────────────
self.addEventListener("install", event => {
  console.log("[SW] Install");
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  self.skipWaiting();
});

// ── ACTIVATE : nettoyer les anciens caches ───────────────────
self.addEventListener("activate", event => {
  console.log("[SW] Activate");
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── FETCH : stratégie Cache-First pour les statics
//            Network-Only pour Firebase (Firestore / Auth / Storage)
// ────────────────────────────────────────────────────────────
self.addEventListener("fetch", event => {
  const url = event.request.url;

  // Firebase → toujours réseau, jamais cache
  if (
    url.includes("firestore.googleapis.com") ||
    url.includes("firebase.googleapis.com")  ||
    url.includes("firebasestorage.googleapis.com") ||
    url.includes("identitytoolkit.googleapis.com")  ||
    url.includes("securetoken.googleapis.com")
  ) {
    return; // laisser le navigateur gérer normalement
  }

  // Pour tout le reste : Cache-First avec fallback réseau
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Mettre en cache les nouvelles ressources GET réussies
        if (
          event.request.method === "GET" &&
          response.status === 200 &&
          !url.startsWith("chrome-extension")
        ) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Hors-ligne : retourner index.html pour les navigations
        if (event.request.mode === "navigate") {
          return caches.match("/index.html");
        }
      });
    })
  );
});

// ── NOTIFICATIONS PUSH (Firebase Cloud Messaging) ───────────
self.addEventListener("push", event => {
  const data = event.data ? event.data.json() : {};
  const title   = data.title   || "Juswell Nexus";
  const options = {
    body:   data.body    || "Vous avez un nouveau message.",
    icon:   "/icons/icon-192.png",
    badge:  "/icons/icon-192.png",
    data:   { groupId: data.groupId || null },
    vibrate: [200, 100, 200]
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Clic sur notification → ouvrir l'app sur le bon groupe
self.addEventListener("notificationclick", event => {
  event.notification.close();
  const groupId = event.notification.data?.groupId;
  const url = groupId ? `/?group=${groupId}` : "/";
  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && "focus" in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
