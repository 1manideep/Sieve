// Keepalive tick for the extension bridge (50 section 6.5): a worker's timers are not throttled like a hidden tab's.
setInterval(() => postMessage('tick'), 20_000);
