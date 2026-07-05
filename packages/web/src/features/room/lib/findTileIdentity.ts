/** Walk up the DOM from target to find the nearest element with data-identity. */
export function findTileIdentity(target: EventTarget | null, container: HTMLElement | null): string | null {
    let el = target as HTMLElement | null;
    while (el && el !== container) {
        if (el.dataset.identity) return el.dataset.identity;
        el = el.parentElement;
    }
    return null;
}
