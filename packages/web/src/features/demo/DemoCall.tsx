import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import callScreenshot from '../../../../../screenshots/call.png';
import { setLiveParticipants } from '../../lib/roomStatusStore';
import { leaveRoom, onRoomsChanged, peopleIn } from './server';
import './demo.css';

/** A real Lala server to try calls on, and the repository for hosting one. */
const LIVE_SERVER = 'https://lala.egor-solovev.dev';
const REPOSITORY = 'https://github.com/eeegoloauq/lala#readme';

/** Stands in for the call in the demo build, which has no media server. */
export default function DemoCall({ roomId, onLeave }: { roomId: string; onLeave: () => void }) {
    const { t } = useTranslation();
    // In a call the sidebar lists the room from LiveKit; here the demo server stands in.
    useEffect(() => {
        const sync = () => setLiveParticipants(peopleIn(roomId));
        sync();
        const unsubscribe = onRoomsChanged(sync);
        return () => { unsubscribe(); leaveRoom(roomId); };
    }, [roomId]);
    return (
        <div className="empty-state demo-call">
            <img className="demo-call-shot" src={callScreenshot} alt={t('demo.screenshotAlt')} />
            <h2 className="empty-state-title">{t('demo.callTitle')}</h2>
            <p className="empty-state-sub demo-call-sub">{t('demo.callDesc')}</p>
            <div className="demo-call-actions">
                <a className="btn btn-primary" href={LIVE_SERVER} target="_blank" rel="noopener noreferrer">{t('demo.tryLive')}</a>
                <a className="btn btn-ghost" href={REPOSITORY} target="_blank" rel="noopener noreferrer">{t('demo.selfHost')}</a>
                <button type="button" className="btn btn-ghost" onClick={onLeave}>{t('room.back')}</button>
            </div>
        </div>
    );
}
