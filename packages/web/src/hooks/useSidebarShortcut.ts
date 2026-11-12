import { useEffect, useRef } from 'react';
import type { AppSettings } from '../features/settings/types';

const IGNORED_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * The room list's shortcut, in and out of a call (the call's own shortcuts live in
 * useRoomKeyboard). Follows the same rules: off with the shortcut switch, never while
 * typing or with a modifier, and the push-to-talk key belongs to push-to-talk.
 */
export function useSidebarShortcut(settings: AppSettings, onToggle: () => void) {
    const ref = useRef({ settings, onToggle });
    ref.current = { settings, onToggle };

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const { settings: s, onToggle: toggle } = ref.current;
            if (!s.shortcutsEnabled || e.code !== s.keySidebar || e.repeat) return;
            if (s.pushToTalk && e.code === s.pushToTalkKey) return;
            if (e.ctrlKey || e.metaKey || e.altKey) return;
            const target = e.target as HTMLElement | null;
            if (target && (IGNORED_TAGS.has(target.tagName) || target.isContentEditable)) return;
            e.preventDefault();
            toggle();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);
}
