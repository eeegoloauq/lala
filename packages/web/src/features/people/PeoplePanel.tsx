import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PresenceStatus, RoomInfo } from '../../lib/types';
import { avatarColorForIdentity } from '../../lib/avatarUtils';
import { isBotIdentity } from '../../lib/bots';
import { openProfile } from '../../lib/profileCard';
import { useMyStatus, usePresence } from '../../lib/presence';
import { useAvatarForIdentity } from '../../lib/roomStatusStore';
import { useMeContext } from '../../lib/meContext';
import { BotBadge } from '../../ui/BotBadge';
import { WithStatus } from '../../ui/StatusDot';
import { SpeakerIcon } from '../room/icons/Icons';
import '../../ui/panel.css';
import './people-panel.css';

interface Person {
    identity: string;
    name: string;
    /** Absent for bots, which have no presence of their own. */
    status?: PresenceStatus;
    room?: string;
}

interface PeoplePanelProps {
    rooms: RoomInfo[];
    displayName: string;
    /** Narrow screens show the panel over the page, with a close button. */
    onClose?: () => void;
}

const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);

/**
 * Everyone on the server, on the right: who is in a call (and where), who else has the app
 * open, and the config's members who don't. Calls come from the room list, the rest from
 * presence; one person appears once.
 */
export const PeoplePanel = memo(function PeoplePanel({ rooms, displayName, onClose }: PeoplePanelProps) {
    const { t } = useTranslation();
    const me = useMeContext();
    const presence = usePresence();
    const myStatus = useMyStatus();
    const myIdentity = me?.identity;

    const groups = useMemo(() => {
        const statusOf = (identity: string): PresenceStatus | undefined =>
            identity === myIdentity ? myStatus : isBotIdentity(identity) ? undefined : presence?.get(identity)?.status ?? 'online';
        const nameOf = (identity: string, fallback: string) => identity === myIdentity ? displayName : fallback;
        const seen = new Set<string>();
        const inCall: Person[] = [];
        // Rooms in the order of the room list, people by name inside each.
        for (const room of rooms) {
            const people = room.participants
                .filter(p => !seen.has(p.identity))
                .map(p => ({ identity: p.identity, name: nameOf(p.identity, p.name), status: statusOf(p.identity), room: room.displayName }))
                .sort(byName);
            for (const p of people) seen.add(p.identity);
            inCall.push(...people);
        }
        const online: Person[] = [];
        const offline: Person[] = [];
        for (const p of presence?.values() ?? []) {
            if (seen.has(p.identity)) continue;
            const person = { identity: p.identity, name: nameOf(p.identity, p.name), status: statusOf(p.identity) };
            (person.status === 'offline' ? offline : online).push(person);
        }
        return { inCall, online: online.sort(byName), offline: offline.sort(byName) };
    }, [rooms, presence, myIdentity, myStatus, displayName]);

    return (
        <aside className={`people-panel${onClose ? ' people-overlay' : ''}`} aria-label={t('people.title')}>
            <div className="panel-header people-header">
                <span className="people-title">{t('people.title')}</span>
                {onClose && (
                    <button className="panel-close people-close" onClick={onClose} title={t('sidebar.close')} aria-label={t('sidebar.close')}>✕</button>
                )}
            </div>
            <div className="people-list">
                <Group title={t('people.inCall')} people={groups.inCall} myIdentity={myIdentity} />
                <Group title={t('people.online')} people={groups.online} myIdentity={myIdentity} />
                <Group title={t('people.offline')} people={groups.offline} myIdentity={myIdentity} />
            </div>
        </aside>
    );
});

function Group({ title, people, myIdentity }: { title: string; people: Person[]; myIdentity?: string }) {
    if (people.length === 0) return null;
    return (
        <section className="people-group" aria-label={title}>
            <h2 className="section-title people-group-title">{title} — {people.length}</h2>
            {people.map(p => <PersonRow key={p.identity} person={p} isSelf={p.identity === myIdentity} />)}
        </section>
    );
}

const PersonRow = memo(function PersonRow({ person, isSelf }: { person: Person; isSelf: boolean }) {
    const { t } = useTranslation();
    const avatar = useAvatarForIdentity(person.identity);
    const isBot = isBotIdentity(person.identity);
    const offline = person.status === 'offline';
    // The card opens to the left: the panel is at the right edge.
    const open = (e: React.MouseEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        openProfile({ identity: person.identity, name: person.name, x: rect.left - 296, y: rect.top });
    };
    return (
        <button className={`person-row people-row${offline ? ' people-row-offline' : ''}`} onClick={open} data-person={person.identity}>
            <WithStatus status={isBot ? undefined : person.status}>
                <span className="person-avatar" style={{ background: avatar ? 'transparent' : avatarColorForIdentity(person.identity) }}>
                    {avatar
                        ? <img src={avatar} alt="" draggable={false} />
                        : person.name[0]?.toUpperCase() ?? '?'}
                </span>
            </WithStatus>
            <span className="people-row-text">
                <span className="people-row-name">
                    <span className="person-name">{person.name}</span>
                    {isBot && <BotBadge />}
                    {isSelf && <span className="person-you">{t('sidebar.you')}</span>}
                </span>
                {person.room && (
                    <span className="people-row-room"><SpeakerIcon size={11} />{person.room}</span>
                )}
            </span>
        </button>
    );
});
