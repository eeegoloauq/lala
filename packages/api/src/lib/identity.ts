import { createHmac, randomUUID } from 'crypto';
import type { Request } from 'express';

/**
 * The device ID is the client's private credential; the identity derived from it is
 * public (LiveKit shows it to every participant). Only the identity may ever leave
 * the server — anyone holding a device ID can act as that device.
 */
export function deriveIdentity(deviceId: string | undefined): string {
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    if (!apiSecret) throw new Error('LIVEKIT_API_SECRET must be set');
    return deviceId
        ? createHmac('sha256', apiSecret).update(deviceId).digest('hex').slice(0, 36)
        : randomUUID();
}

/** The caller's identity from the `X-Lala-Device` header the web client sends on every request. */
export function callerIdentity(req: Request): string | undefined {
    const deviceId = req.header('X-Lala-Device');
    return deviceId && deviceId.length <= 100 ? deriveIdentity(deviceId) : undefined;
}
