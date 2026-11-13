import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PresenceActivity, PresenceProfile } from '../../lib/types';
import { safeActivityUrl } from '../../lib/activityLinks';
import { activityImageUrl } from '../../lib/api';
import { ClockIcon, DesktopIcon, GlobeIcon, MusicIcon, PhoneIcon } from '../room/icons/Icons';

/** The current time, ticking every `ms`; the timers on the card move with it. */
function useNow(ms: number): number {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), ms);
        return () => clearInterval(timer);
    }, [ms]);
    return now;
}

/** "1h 20m", "12m", "less than a minute" as "0m": how long, never since when. */
function formatLength(ms: number, locale: string): string {
    const minutes = Math.max(0, Math.floor(ms / 60_000));
    const hours = Math.floor(minutes / 60);
    const parts = { hours: hours || undefined, minutes: minutes % 60 };
    // Intl.DurationFormat knows each language's short units; older engines get the plain form.
    const Duration = (Intl as unknown as { DurationFormat?: new (l: string, o: object) => { format(d: object): string } }).DurationFormat;
    if (Duration) return new Duration(locale, { style: 'narrow' }).format(parts);
    return hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

/** A song position as m:ss. */
const clock = (ms: number) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export function DeviceMark({ device }: { device: NonNullable<PresenceProfile['device']> }) {
    const { t } = useTranslation();
    const label = t(device === 'desktop' ? 'profile.onDesktop' : device === 'phone' ? 'profile.onPhone' : 'profile.onWeb');
    const Icon = device === 'desktop' ? DesktopIcon : device === 'phone' ? PhoneIcon : GlobeIcon;
    return <span className="profile-device" title={label} aria-label={label}><Icon size={13} strokeWidth={2} /></span>;
}

/** Their time in their zone, written the way the viewer's language writes times (11:40 PM, 23:40). */
export function LocalTime({ timeZone }: { timeZone: string }) {
    const { t, i18n } = useTranslation();
    const now = useNow(15_000);
    let time: string;
    try {
        time = new Intl.DateTimeFormat(i18n.language, { hour: 'numeric', minute: '2-digit', timeZone }).format(now);
    } catch {
        return null; // a zone this engine doesn't know
    }
    return (
        <div className="profile-local-time">
            <ClockIcon size={13} strokeWidth={2} />
            <span>{t('profile.localTime', { time })}</span>
        </div>
    );
}

export function ActivityBlock({ activity }: { activity: PresenceActivity }) {
    const { t, i18n } = useTranslation();
    const now = useNow(activity.kind === 'listening' && !activity.paused ? 1000 : 30_000);
    const url = safeActivityUrl(activity.url);

    if (activity.kind === 'playing') {
        return (
            <section>
                <h4 className="profile-label">{t('profile.playing')}</h4>
                <div className="profile-activity">
                    <ActivityImage src={activity.image} />
                    <div className="profile-activity-text">
                        <strong><Title text={activity.name} url={url} /></strong>
                        <span>{formatLength(now - activity.startedAt, i18n.language)}</span>
                    </div>
                </div>
            </section>
        );
    }

    const { durationMs } = activity;
    const moved = activity.paused ? 0 : now - activity.positionAt;
    // Past the end without a new track: the player stopped telling, so hold at the end.
    const position = Math.min(activity.positionMs + moved, durationMs ?? Infinity);
    return (
        <section>
            <h4 className="profile-label profile-label-row">
                <span>{t('profile.listening')}</span>
                <span className="profile-player">{activity.player}</span>
            </h4>
            <div className="profile-activity">
                <ActivityImage src={activity.image} music />
                <div className="profile-activity-text">
                    <strong><Title text={activity.title} url={url} /></strong>
                    {activity.artist && <span title={activity.artist}>{t('profile.by', { artist: activity.artist })}</span>}
                    {activity.album && <span className="profile-album" title={activity.album}>{activity.album}</span>}
                </div>
            </div>
            {durationMs ? (
                <div className="profile-progress">
                    <progress max={durationMs} value={position} aria-label={`${clock(position)} / ${clock(durationMs)}`} />
                    <div className="profile-progress-times">
                        <span>{activity.paused ? t('profile.paused') : clock(position)}</span>
                        <span>{clock(durationMs)}</span>
                    </div>
                </div>
            ) : null}
        </section>
    );
}

/** A title that opens the track or game page when its link passed the allowlist. */
function Title({ text, url }: { text: string; url?: string }) {
    if (!url) return <span title={text}>{text}</span>;
    return <a className="profile-activity-link" href={url} target="_blank" rel="noopener noreferrer" title={`${text} · ${new URL(url).hostname}`}>{text}</a>;
}

function ActivityImage({ src, music }: { src?: string; music?: boolean }) {
    const url = activityImageUrl(src);
    return (
        <div className="profile-activity-image">
            {url ? <img src={url} alt="" /> : music ? <MusicIcon size={22} /> : null}
        </div>
    );
}
