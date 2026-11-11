import { useTranslation } from 'react-i18next';
import type { RoomInfo } from '../../lib/types';
import { IS_DEMO } from '../../lib/env';
import { getCachedAvatar } from '../../lib/avatarUtils';
import { Avatar } from '../room/VideoGrid/Avatar';
import { EarIcon } from '../room/icons/Icons';
import './waveform-welcome.css';

const BARS = Array.from({ length: 32 });
const FACES = 5;
const NAMED = 2;

interface WaveformWelcomeProps {
  rooms: RoomInfo[];
  onJoinRoom: (id: string) => void;
}

/** The room most people are in that the caller may join, if anyone is talking anywhere. */
function busiestRoom(rooms: RoomInfo[]): RoomInfo | undefined {
  return rooms
    .filter(r => r.canJoin && r.numParticipants > 0)
    .reduce<RoomInfo | undefined>((best, r) => (!best || r.numParticipants > best.numParticipants ? r : best), undefined);
}

/** Not in a call: the waveform, and one step to the busiest room under it. */
export function WaveformWelcome({ rooms, onJoinRoom }: WaveformWelcomeProps) {
  const { t } = useTranslation();
  const room = busiestRoom(rooms);
  const people = room?.participants ?? [];
  const listening = room?.listeningParticipants.length ?? 0;

  return (
    <div className="waveform-welcome">
      <div className="waveform-bars" aria-hidden="true">
        {BARS.map((_, i) => (
          <div
            key={i}
            className="waveform-bar"
            style={{ '--i': i } as React.CSSProperties}
          />
        ))}
      </div>
      {room ? (
        <div className="welcome-room">
          <div className="welcome-faces" aria-hidden="true">
            {people.slice(0, FACES).map(p => (
              <Avatar key={p.identity} name={p.name} identity={p.identity} size={28} avatarUrl={getCachedAvatar(p.identity) ?? undefined} />
            ))}
          </div>
          <button className="btn btn-primary welcome-join" onClick={() => onJoinRoom(room.id)}>
            {t('welcome.join', { name: room.displayName })}
          </button>
          <small className="welcome-talking">
            {people.length > NAMED
              ? t('welcome.talkingMore', { names: people.slice(0, NAMED).map(p => p.name).join(', '), count: people.length - NAMED })
              : t('welcome.talking', { names: people.map(p => p.name).join(', '), count: people.length })}
          </small>
          {listening > 0 && (
            <span className="welcome-listens"><EarIcon size={13} strokeWidth={2} />{t('bot.roomListens')}</span>
          )}
        </div>
      ) : (
        <p className="waveform-welcome-hint">{t('welcome.lobbyHint')}</p>
      )}
      {IS_DEMO && <p className="waveform-welcome-hint waveform-welcome-demo">{t('demo.lobbyNote')}</p>}
    </div>
  );
}
