import type { Response } from 'express';

const clients = new Set<Response>();

export function addSseClient(res: Response): void {
    clients.add(res);
}

export function removeSseClient(res: Response): void {
    clients.delete(res);
}

export function broadcastSse(event: string, data: unknown = {}): void {
    const sanitizedEvent = event.replace(/[\r\n]/g, '');
    const msg = `event: ${sanitizedEvent}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of clients) {
        try {
            res.write(msg);
        } catch {
            clients.delete(res);
        }
    }
}

export function sseClientCount(): number {
    return clients.size;
}
