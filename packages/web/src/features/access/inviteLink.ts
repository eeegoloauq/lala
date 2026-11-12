/** Takes `name` out of the URL fragment and leaves the rest (a room password) to the router. */
export function takeFromHash(name: string): string | null {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const value = params.get(name);
    if (value === null) return null;
    params.delete(name);
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `#${rest}` : ''));
    return value;
}

/** A server invite (`#invite=`), which stands in for the server password. */
export const takeInviteFromHash = () => takeFromHash('invite');
