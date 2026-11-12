import type { Response } from 'express';

/** Each open event stream, with the person its ticket names (none without a ticket). */
const clients = new Map<Response, { identity?: string; ip?: string }>();

export function addSseClient(res: Response, identity?: string, ip?: string): void {
    clients.set(res, { identity, ip });
}

export function removeSseClient(res: Response): void {
    clients.delete(res);
}

const format = (event: string, data: unknown) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** To every stream: events that say only that something changed. */
export function broadcastSse(event: string, data: unknown = {}): void {
    const msg = format(event, data);
    for (const res of clients.keys()) res.write(msg);
}

/**
 * To the streams of people `allowed` picks: events that carry content (a chat message)
 * reach no stream without a ticket, so no one who may not read it.
 */
export async function sendToAllowed(
    event: string, data: unknown,
    allowed: (people: Array<{ identity: string; ip?: string }>) => Promise<Set<string>>,
): Promise<void> {
    const named = [...clients.values()].filter((c): c is { identity: string; ip?: string } => c.identity !== undefined);
    if (named.length === 0) return;
    const ok = await allowed(named);
    const msg = format(event, data);
    for (const [res, { identity }] of clients) if (identity !== undefined && ok.has(identity)) res.write(msg);
}
