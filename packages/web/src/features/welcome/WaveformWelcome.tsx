import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import type { NewRoom, RoomInfo } from '../../lib/types';
import { getTemplates } from '../../lib/roomTemplates';
import { useMeContext } from '../../lib/meContext';
import { CreateRoomModal } from '../channels/CreateRoomModal';
import { IS_DEMO } from '../../lib/env';
import { useAvatarMap } from '../../lib/roomStatusStore';
import { Avatar } from '../room/VideoGrid/Avatar';
import { EarIcon } from '../room/icons/Icons';
import './waveform-welcome.css';

const BARS = Array.from({ length: 32 });
const FACES = 5;
const NAMED = 2;

interface WaveformWelcomeProps {
  rooms: RoomInfo[];
  onJoinRoom: (id: string) => void;
  /** Creates a room, or joins the live one with that name. */
  onCreateRoom: (req: NewRoom) => Promise<void>;
}

/** The room most people are in that the caller may join, if anyone is talking anywhere. */
function busiestRoom(rooms: RoomInfo[]): RoomInfo | undefined {
  return rooms
    .filter(r => r.canJoin && r.numParticipants > 0)
    .reduce<RoomInfo | undefined>((best, r) => (!best || r.numParticipants > best.numParticipants ? r : best), undefined);
}

/**
 * Not in a call: the waveform, and one step under it: to the busiest room, else back to
 * the room this device was in last, else to a new room.
 */
export function WaveformWelcome({ rooms, onJoinRoom, onCreateRoom }: WaveformWelcomeProps) {
  const { t } = useTranslation();
  const me = useMeContext();
  const canCreate = me?.canCreateRooms ?? false;
  const [creating, setCreating] = useState(false);
  const room = busiestRoom(rooms);
  // The last room, from the rooms saved on this device: live under its name, or made again.
  const last = room ? undefined : getTemplates()[0];
  const lastLive = last && rooms.find(r => r.canJoin && r.displayName.toLowerCase() === last.name.toLowerCase());
  const rejoin = lastLive || (last && canCreate) ? last : undefined;
  const people = room?.participants ?? [];
  const avatars = useAvatarMap();
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
              <Avatar key={p.identity} name={p.name} identity={p.identity} size={28} avatarUrl={avatars.get(p.identity)} />
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
      ) : rejoin ? (
        <div className="welcome-room">
          <button
            className="btn btn-primary welcome-join"
            onClick={() => lastLive ? onJoinRoom(lastLive.id) : onCreateRoom(rejoin).catch(() => setCreating(true))}
          >
            {t('welcome.rejoin', { name: rejoin.name })}
          </button>
          <small className="welcome-talking">{t('welcome.rejoinHint')}</small>
        </div>
      ) : canCreate ? (
        <div className="welcome-room">
          <button className="btn btn-primary welcome-join" onClick={() => setCreating(true)}>
            {t('welcome.create')}
          </button>
          <small className="welcome-talking">{t('welcome.createHint')}</small>
        </div>
      ) : (
        <p className="waveform-welcome-hint">{t('welcome.lobbyHint')}</p>
      )}
      {creating && <CreateRoomModal onConfirm={onCreateRoom} onClose={() => setCreating(false)} />}
      {IS_DEMO && <p className="waveform-welcome-hint waveform-welcome-demo">{t('demo.lobbyNote')}</p>}
    </div>
  );
}
