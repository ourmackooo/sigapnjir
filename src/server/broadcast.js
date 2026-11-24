// Stub broadcast satu arah. Produksi: sambungkan provider SMS/WhatsApp lewat env.
export async function sendBroadcast({ message, recipients = 0, eventId, audit }) {
  const provider = Bun.env.BROADCAST_PROVIDER ?? "log";
  if (provider === "log") console.log(`[broadcast:${eventId ?? "-"}] ${message} (${recipients} penerima)`);
  await audit?.({
    action: "broadcast",
    entity_type: "disaster_event",
    entity_id: String(eventId),
    metadata: { provider, recipients, message },
  });
  return { provider, sent: recipients, stub: true };
}
