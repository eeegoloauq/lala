import { useTranslation } from 'react-i18next';
import type { PresenceStatus } from '../lib/types';
import './status-dot.css';

/**
 * The presence mark on an avatar's corner: a dot, a moon for idle, a bar for do not disturb,
 * a ring for offline. The shape carries the meaning as well as the color.
 */
export function StatusDot({ status, labelled = true }: { status: PresenceStatus; /** False beside text that already says it. */ labelled?: boolean }) {
    const { t } = useTranslation();
    const label = labelled ? { role: 'img', 'aria-label': t(`status.${status}`), title: t(`status.${status}`) } : { 'aria-hidden': true };
    return (
        <span className="status-dot" {...label}>
            <span className={`status-dot-mark status-${status}`} />
        </span>
    );
}

/** An avatar with the status mark on its lower right corner. */
export function WithStatus({ status, children }: { status: PresenceStatus | undefined; children: React.ReactNode }) {
    return (
        <span className="status-avatar">
            {children}
            {status && <StatusDot status={status} />}
        </span>
    );
}
