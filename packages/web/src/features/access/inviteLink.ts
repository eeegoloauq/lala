/** Takes `invite` out of the URL fragment and leaves the rest (a room password) to the router. */
export function takeInviteFromHash(): string | null {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const invite = params.get('invite');
    if (invite === null) return null;
    params.delete('invite');
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `#${rest}` : ''));
    return invite;
}
