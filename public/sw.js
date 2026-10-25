/*
 * TripCraft service worker — push notifications ONLY.
 * No fetch handler and no caching on purpose: the app has no offline support
 * (CLAUDE.md). It shows the pushes the notify Edge Function sends
 * ({ title, body, url }) and opens the right screen when one is clicked.
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of open tabs so a click can navigate them (Client.navigate).
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = typeof data.title === "string" && data.title ? data.title : "TripCraft";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof data.body === "string" ? data.body : "",
      data: { url: typeof data.url === "string" ? data.url : "/" },
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      dir: "rtl",
      lang: "he",
    }),
  );
});

/** Same-origin paths only — a payload can never send the user to another site. */
function targetUrl(raw) {
  try {
    const url = new URL(raw || "/", self.location.origin);
    return url.origin === self.location.origin ? url.href : self.location.origin + "/";
  } catch {
    return self.location.origin + "/";
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = targetUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const client = windows.find((c) => new URL(c.url).origin === self.location.origin);
      if (client) {
        try {
          await client.focus();
          await client.navigate(url);
          return;
        } catch {
          // Not controlled by this worker yet (opened before it activated): open a fresh window.
        }
      }
      await self.clients.openWindow(url);
    })(),
  );
});
