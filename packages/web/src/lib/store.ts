/** A value outside React that components read with useSyncExternalStore. */
type Listener = () => void;

export function createStore<T>(initial: T) {
    let state = initial;
    const listeners = new Set<Listener>();
    return {
        get: () => state,
        set(next: T): void {
            state = next;
            listeners.forEach((l) => l());
        },
        subscribe(listener: Listener): () => void {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}
