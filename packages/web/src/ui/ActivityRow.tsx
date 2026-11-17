import { useState, type ReactNode } from 'react';
import { MusicIcon } from '../features/room/icons/Icons';
import { activityImageUrl } from '../lib/api';
import { safeActivityUrl } from '../lib/activityLinks';
import './activity-row.css';

interface ActivityRowProps {
    title: string;
    image?: string;
    url?: string;
    music?: boolean;
    children: ReactNode;
}

export function ActivityRow({ title, image, url, music, children }: ActivityRowProps) {
    const artwork = activityImageUrl(image);
    const link = safeActivityUrl(url);
    const [failed, setFailed] = useState<string>();
    return (
        <div className="profile-activity">
            <div className="profile-activity-image">
                {artwork && failed !== artwork ? <img src={artwork} alt="" onError={() => setFailed(artwork)} /> : music ? <MusicIcon size={22} /> : null}
            </div>
            <div className="profile-activity-text">
                <strong>
                    {link ? <a className="profile-activity-link" href={link} target="_blank" rel="noopener noreferrer" title={`${title} · ${new URL(link).hostname}`}>{title}</a>
                        : <span title={title}>{title}</span>}
                </strong>
                {children}
            </div>
        </div>
    );
}
