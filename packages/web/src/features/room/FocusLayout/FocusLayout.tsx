import { useCallback, useEffect } from 'react';
import type { ReactNode } from 'react';
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
        <FocusLayoutView
            main={<FocusMain focused={focused} pip={pip} ambient={settings.ambientMode} onSwap={swap} onExit={onExit} onMenu={openMenu} />}
            overlay={contextMenuProps && <ParticipantContextMenu {...contextMenuProps} onClose={closeContextMenu} />}
        >
            {participants.map((p) => {
                const hasContent = hasScreenShare(p.identity) || hasCamera(p.identity);
                return (
                    <FocusStripTile
                        key={p.identity}
                        active={p.identity === selectedIdentity}
                        title={hasContent ? t('focus.focusOn', { name: p.name || p.identity }) : undefined}
                        onClick={(e) => {
                            if (hasContent) pin(p.identity);
                            // A tap has no right button, so on touch screens it also opens the menu.
                            if (isTouchDevice) openMenu(p, e);
                        }}
                        onContextMenu={(e) => openMenu(p, e)}
                    >
                        <ParticipantTile
                            participant={p}
                            // With both a screen and a camera on, the main view already shows their camera, large or as the PiP.
                            trackRef={pip?.track.participant.identity === p.identity ? undefined : cameraMap.get(p.identity)}
                            audioMuted={p.identity === localParticipant.identity ? audioMuted : undefined}
                            avatarUrl={avatarCache?.get(p.identity)}
                        />
                    </FocusStripTile>
                );
            })}
        </FocusLayoutView>
    );
}

/** The focus layout's frame: the large view, a side strip of everyone (`children`) and an overlay such as a menu. */
export function FocusLayoutView({ main, overlay, children }: { main: ReactNode; overlay?: ReactNode; children: ReactNode }) {
    return (
        <div className="fl-area">
            {main}
            <div className="fl-strip">{children}</div>
            {overlay}
        </div>
    );
}

interface FocusStripTileProps {
    active: boolean;
    /** Set when clicking focuses this person, who has a screen or camera to show. */
    title?: string;
    onClick?: (e: React.MouseEvent) => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    children: ReactNode;
}

/** One person in the side strip. */
export function FocusStripTile({ active, title, onClick, onContextMenu, children }: FocusStripTileProps) {
    return (
        <div
            className={`fl-strip-tile${active ? ' fl-strip-active' : ''}${title ? ' fl-strip-clickable' : ''}`}
            onClick={onClick}
            onContextMenu={onContextMenu}
            title={title}
        >
            {children}
        </div>
    );
}
