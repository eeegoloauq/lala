/**
 * Encrypted-at-rest storage for secrets (room passwords, admin secrets).
 *
 * Values are AES-GCM-encrypted with a non-extractable CryptoKey kept in
 * IndexedDB; ciphertext lives in localStorage under `lala_enc_<name>`.
 * This protects persisted secrets from offline exfiltration (disk reads,
 * backups) — it does NOT protect against code running in this origin.
 *
 * The API is synchronous: `initSecureStore()` must resolve before first
 * render (see main.tsx). Reads hit an in-memory cache; writes update the
 * cache synchronously and persist in the background.
 *
 * Degraded mode: if WebCrypto/IndexedDB are unavailable (or the key store
 * was wiped while ciphertexts survived), secrets live in memory only for
 * the session and undecryptable blobs are dropped.
 */

const PHYS_PREFIX = 'lala_enc_';
const IDB_NAME = 'lala-secure';
const IDB_STORE = 'keys';
const KEY_ID = 'main';

/** Legacy plaintext keys migrated into the encrypted store on init. */
const MIGRATE_EXACT = ['lala_passwords', 'lala_room_templates'];
const MIGRATE_PREFIXES = ['lala_room_pw_', 'lala_admin_'];

const cache = new Map<string, string>();
let cryptoKey: CryptoKey | null = null;
// Serializes background persistence so writes to the same key can't interleave.
let writeChain: Promise<void> = Promise.resolve();

function toB64(buf: ArrayBuffer): string {
    const bytes = new Uint8Array(buf);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin);
}

function fromB64(b64: string): Uint8Array {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function idbGet(db: IDBDatabase, id: string): Promise<CryptoKey | undefined> {
    return new Promise((resolve, reject) => {
        const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get(id);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function idbPut(db: IDBDatabase, id: string, key: CryptoKey): Promise<void> {
    return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(key, id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
}

async function loadOrCreateKey(): Promise<CryptoKey> {
    const db = await openDb();
    try {
        const existing = await idbGet(db, KEY_ID);
        if (existing) return existing;
        const key = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false, // non-extractable: the raw key can never leave this origin's IDB
            ['encrypt', 'decrypt'],
        );
        await idbPut(db, KEY_ID, key);
        // Re-read to converge if another tab generated a key concurrently.
        return (await idbGet(db, KEY_ID)) ?? key;
    } finally {
        db.close();
    }
}

async function encrypt(value: string): Promise<string> {
    if (!cryptoKey) throw new Error('secure store not initialized');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        cryptoKey,
        new TextEncoder().encode(value),
    );
    return JSON.stringify({ iv: toB64(iv.buffer), ct: toB64(ct) });
}

async function decrypt(blob: string): Promise<string | null> {
    if (!cryptoKey) return null;
    try {
        const { iv, ct } = JSON.parse(blob) as { iv: string; ct: string };
        const pt = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromB64(iv) as BufferSource },
            cryptoKey,
            fromB64(ct) as BufferSource,
        );
        return new TextDecoder().decode(pt);
    } catch {
        return null;
    }
}

function persist(key: string, value: string | null): void {
    writeChain = writeChain.then(async () => {
        try {
            if (value === null) {
                localStorage.removeItem(PHYS_PREFIX + key);
            } else if (cryptoKey) {
                localStorage.setItem(PHYS_PREFIX + key, await encrypt(value));
            }
        } catch (err) {
            console.warn('secureStore: persist failed for', key, err);
        }
    });
}

/**
 * Hydrate the cache: load the key, decrypt existing blobs, migrate legacy
 * plaintext entries. Never rejects — failures leave the store in
 * memory-only degraded mode.
 */
export async function initSecureStore(): Promise<void> {
    try {
        cryptoKey = await loadOrCreateKey();
    } catch (err) {
        console.warn('secureStore: WebCrypto/IndexedDB unavailable, secrets will not persist', err);
        return;
    }

    const encrypted: string[] = [];
    const legacy: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i)!;
        if (k.startsWith(PHYS_PREFIX)) encrypted.push(k);
        else if (MIGRATE_EXACT.includes(k) || MIGRATE_PREFIXES.some(p => k.startsWith(p))) legacy.push(k);
    }

    for (const physKey of encrypted) {
        const value = await decrypt(localStorage.getItem(physKey)!);
        if (value !== null) cache.set(physKey.slice(PHYS_PREFIX.length), value);
        else localStorage.removeItem(physKey); // key was lost — blob is dead weight
    }

    for (const k of legacy) {
        const value = localStorage.getItem(k);
        if (value !== null && !cache.has(k)) {
            cache.set(k, value);
            persist(k, value);
        }
        localStorage.removeItem(k);
    }

    // Keep the cache coherent when another tab writes a secret.
    window.addEventListener('storage', (e) => {
        if (!e.key?.startsWith(PHYS_PREFIX)) return;
        const key = e.key.slice(PHYS_PREFIX.length);
        if (e.newValue === null) { cache.delete(key); return; }
        void decrypt(e.newValue).then(v => { if (v !== null) cache.set(key, v); });
    });
}

export function secureGet(key: string): string | null {
    return cache.get(key) ?? null;
}

export function secureSet(key: string, value: string): void {
    cache.set(key, value);
    persist(key, value);
}

export function secureRemove(key: string): void {
    cache.delete(key);
    persist(key, null);
}

/** List cached keys starting with the given prefix. */
export function secureKeys(prefix: string): string[] {
    return [...cache.keys()].filter(k => k.startsWith(prefix));
}
