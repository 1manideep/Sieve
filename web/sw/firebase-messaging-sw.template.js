// Built by the sieveMessagingSw Vite plugin. Placeholders are replaced at build and dev-serve time.
// The notification never carries content: title "Sieve", body "A request is waiting" (40 section 10.6).
/* global self, importScripts, clients, firebase, __FIREBASE_CONFIG__ */
self.addEventListener('notificationclick', (event) => {
  if (event.notification.tag !== 'sieve-request') return;      // notifications shown by the FCM SDK are handled by it
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const mine = wins.find((c) => new URL(c.url).origin === self.location.origin);
    if (mine) {
      await mine.focus();
      new BroadcastChannel('sieve').postMessage({ type: 'open-requests' });
      return;
    }
    await clients.openWindow('/requests');
  })());
});
importScripts('https://www.gstatic.com/firebasejs/__FIREBASE_VERSION__/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/__FIREBASE_VERSION__/firebase-messaging-compat.js');
firebase.initializeApp(__FIREBASE_CONFIG__);
const messaging = firebase.messaging();
messaging.onBackgroundMessage((payload) => {
  if (payload.notification) return;                             // notification messages are displayed by the SDK
  self.registration.showNotification('Sieve', { body: 'A request is waiting', tag: 'sieve-request', icon: '/favicon.svg' });
});
