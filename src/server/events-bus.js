// # ponytail: SSE in-process, cukup satu instance. Ganti ke Redis pub/sub bila scale-out.
const clients = new Map();

export function subscribe(eventId, controller) {
  if (!clients.has(eventId)) clients.set(eventId, new Set());
  clients.get(eventId).add(controller);
  return () => {
    clients.get(eventId)?.delete(controller);
    if (clients.get(eventId)?.size === 0) clients.delete(eventId);
  };
}

export function publish(eventId, payload) {
  const group = clients.get(eventId);
  if (!group) return;
  const chunk = `data: ${JSON.stringify(payload)}\n\n`;
  for (const controller of [...group]) {
    try { controller.enqueue(new TextEncoder().encode(chunk)); }
    catch { group.delete(controller); }
  }
}
