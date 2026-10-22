import { STORAGE_KEYS } from './constants';

const LEAKED_IDENTITY_KEY = 'lala-identity';

/** Returns this device's private UUID, creating one if needed. Never send it anywhere but the API. */
export function getDeviceId(): string {
    localStorage.removeItem(LEAKED_IDENTITY_KEY);
    let id = localStorage.getItem(STORAGE_KEYS.identity);
    if (!id) {
        id = crypto.randomUUID();
        localStorage.setItem(STORAGE_KEYS.identity, id);
    }
    return id;
}

const CACHED_HMAC_KEY = 'lala_cached_hmac_identity';
const CACHED_HMAC_DEVICE_KEY = 'lala_cached_hmac_device';

/** Returns cached HMAC identity only if it was derived from the current device UUID. */
export function getCachedHmacIdentity(deviceId: string): string | null {
    if (localStorage.getItem(CACHED_HMAC_DEVICE_KEY) !== deviceId) return null;
    return localStorage.getItem(CACHED_HMAC_KEY);
}

export function saveCachedHmacIdentity(deviceId: string, identity: string) {
    localStorage.setItem(CACHED_HMAC_DEVICE_KEY, deviceId);
    localStorage.setItem(CACHED_HMAC_KEY, identity);
}
