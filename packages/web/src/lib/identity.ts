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
