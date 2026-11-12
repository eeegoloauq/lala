import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PresenceChoice } from '../../lib/types';
import { useDismiss } from '../../hooks/useDismiss';
import { StatusDot } from '../../ui/StatusDot';
import { CheckIcon } from '../room/icons/Icons';
import { PRESENCE_CHOICES } from '../settings/types';
import '../room/VideoGrid/participant-context-menu.css';
import './status-menu.css';

interface StatusMenuProps {
    current: PresenceChoice;
    /** The element it opens from; the menu sits above it. */
    anchor: DOMRect;
    onPick: (status: PresenceChoice) => void;
    onClose: () => void;
}

const GAP = 8;

/** Picks the status others see, from the avatar in the room list's footer. */
export function StatusMenu({ current, anchor, onPick, onClose }: StatusMenuProps) {
    const { t } = useTranslation();
    const ref = useRef<HTMLDivElement>(null);
    const [top, setTop] = useState(anchor.top);
    useDismiss(ref, onClose);
    useLayoutEffect(() => {
        setTop(Math.max(GAP, anchor.top - (ref.current?.offsetHeight ?? 0) - GAP));
    }, [anchor]);

    return (
        <div className="ctx-menu status-menu" ref={ref} role="menu" style={{ position: 'fixed', top, left: anchor.left }}>
            {PRESENCE_CHOICES.map(status => (
                <button
                    key={status}
                    className="ctx-menu-item status-menu-item"
                    role="menuitemradio"
                    aria-checked={status === current}
                    onClick={() => { onPick(status); onClose(); }}
                >
                    <StatusDot status={status === 'invisible' ? 'offline' : status} labelled={false} />
                    <span className="status-menu-text">
                        <span>{t(`status.${status}`)}</span>
                        {(status === 'dnd' || status === 'invisible' || status === 'idle') && (
                            <span className="status-menu-hint">{t(`status.${status}Hint`)}</span>
                        )}
                    </span>
                    {status === current && <CheckIcon size={14} strokeWidth={2.2} />}
                </button>
            ))}
        </div>
    );
}
