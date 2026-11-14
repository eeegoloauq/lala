/** Someone focused by hand; auto-focus leaves them until they leave or, if they were sharing, stop. */
export interface FocusPin { identity: string; wasSharing: boolean }

interface FocusInput {
    /** Who the view shows now. */
    current: string | null;
    pin: FocusPin | null;
    own: string;
    /** Everyone sharing a screen now. */
    shares: ReadonlySet<string>;
    /** Shares that started since the last decision. */
    appeared: readonly string[];
    /** Shares that ended since the last decision. */
    ended: readonly string[];
    isPresent: (identity: string) => boolean;
    /** Who to show when nobody shares and the current pick is gone. */
    fallback: string | null;
}

/**
 * Whose screen or camera the focus view shows after shares or people changed. Used by the
 * call (useFocus) and the demo (useDemoFocus), so both follow the same rules:
 * - a pick by hand sticks;
 * - a new share by someone else takes the view, unless you are already watching someone
 *   else's share (then it waits in the strip, one tap away);
 * - your own new share takes the view only when nobody else shares;
 * - when the share on view ends, another one takes its place, someone else's first.
 */
export function nextFocus({ current, pin, own, shares, appeared, ended, isPresent, fallback }: FocusInput): { selected: string | null; pin: FocusPin | null } {
    if (pin && isPresent(pin.identity) && !(pin.wasSharing && !shares.has(pin.identity))) {
        return { selected: current, pin };
    }
    const watchingOther = !!current && current !== own && shares.has(current) && !appeared.includes(current);
    const newOther = appeared.filter((id) => id !== own);
    if (newOther.length > 0 && !watchingOther) return { selected: newOther[newOther.length - 1], pin: null };
    if (appeared.includes(own) && ![...shares].some((id) => id !== own)) return { selected: own, pin: null };
    if (current && ended.includes(current) && shares.size > 0) {
        return { selected: [...shares].find((id) => id !== own) ?? own, pin: null };
    }
    if (current && isPresent(current)) return { selected: current, pin: null };
    return { selected: shares.values().next().value ?? fallback, pin: null };
}
