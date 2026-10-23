import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocalParticipant } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { ParticipantTile } from '../VideoGrid/ParticipantTile';
import { ParticipantContextMenu } from '../VideoGrid/ParticipantContextMenu';
import { useParticipantContextMenu } from '../hooks/useParticipantContextMenu';
import { useRoomUIContext } from '../RoomUIContext';
import { IS_TOUCH as isTouchDevice } from '../../../lib/env';
import { useFocus } from './useFocus';
import { FocusMain } from './FocusMain';
import './focus-layout.css';

interface FocusLayoutProps {
    initialIdentity?: string | null;
    onExit?: () => void;
}

export function FocusLayout({ initialIdentity, onExit }: FocusLayoutProps) {
    const { t } = useTranslation();
    const { audioMuted, avatarCache, settings } = useRoomUIContext();
    const { localParticipant } = useLocalParticipant();
    const { participants, cameraMap, selectedIdentity, focused, pip, hasScreenShare, hasCamera, pin, swap } = useFocus(initialIdentity ?? null);
    const { contextMenuProps, openContextMenu, closeContextMenu } = useParticipantContextMenu();

    const openMenu = useCallback((participant: Participant, e: React.MouseEvent) => {
        e.preventDefault();
        openContextMenu(participant, e.clientX, e.clientY);
    }, [openContextMenu]);

    // Leave focus mode once the focused participant shows nothing (e.g. turned off the camera).
    useEffect(() => {
        if (focused || !onExit) return;
        const timer = setTimeout(onExit, 400);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focused]);

    return (
        <div className="fl-area">
            <FocusMain focused={focused} pip={pip} ambient={settings.ambientMode} onSwap={swap} onExit={onExit} onMenu={openMenu} />

            {/* Side strip — all participants, all clickable */}
            <div className="fl-strip">
                {participants.map((p) => {
                    const hasContent = hasScreenShare(p.identity) || hasCamera(p.identity);
                    return (
                        <div
                            key={p.identity}
                            className={`fl-strip-tile${p.identity === selectedIdentity ? ' fl-strip-active' : ''}${hasContent ? ' fl-strip-clickable' : ''}`}
                            onClick={(e) => {
                                if (hasContent) pin(p.identity);
                                // A tap has no right button, so on touch screens it also opens the menu.
                                if (isTouchDevice) openMenu(p, e);
                            }}
                            onContextMenu={(e) => openMenu(p, e)}
                            title={hasContent ? t('focus.focusOn', { name: p.name || p.identity }) : undefined}
                        >
                            <ParticipantTile
                                participant={p}
                                // With both a screen and a camera on, the main view already shows their camera, large or as the PiP.
                                trackRef={pip?.track.participant.identity === p.identity ? undefined : cameraMap.get(p.identity)}
                                audioMuted={p.identity === localParticipant.identity ? audioMuted : undefined}
                                avatarUrl={avatarCache?.get(p.identity)}
                            />
                        </div>
                    );
                })}
            </div>

            {contextMenuProps && (
                <ParticipantContextMenu {...contextMenuProps} onClose={closeContextMenu} />
            )}
        </div>
    );
}
