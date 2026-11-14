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
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { useFocus } from './useFocus';
import { FocusMain, OWN_SHARE_PLACEHOLDER_QUERY } from './FocusMain';
import { stripContent } from './focusRules';
import './focus-layout.css';

interface FocusLayoutProps {
    /** Shown under the people when there is room: the call's chat on a phone held upright. */
    below?: ReactNode;
    initialIdentity?: string | null;
    onExit?: () => void;
    onStopShare: () => void;
}

export function FocusLayout({ below, initialIdentity, onExit, onStopShare }: FocusLayoutProps) {
    const { t } = useTranslation();
    const { audioMuted, avatarCache, settings } = useRoomUIContext();
    const { localParticipant } = useLocalParticipant();
    const { participants, cameraMap, selectedIdentity, focused, pip, hasScreenShare, screenOf, hasCamera, pin, swap } = useFocus(initialIdentity ?? null);
    const ownShareHidden = useMediaQuery(OWN_SHARE_PLACEHOLDER_QUERY);
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
            main={<FocusMain focused={focused} pip={pip} ambient={settings.ambientMode} onSwap={swap} onExit={onExit} onMenu={openContextMenu} onStopShare={onStopShare} />}
            overlay={contextMenuProps && <ParticipantContextMenu {...contextMenuProps} onClose={closeContextMenu} />}
            below={below}
        >
            {participants.map((p) => {
                const hasContent = hasScreenShare(p.identity) || hasCamera(p.identity);
                const own = p.identity === localParticipant.identity;
                const screen = screenOf(p.identity);
                const content = stripContent({
                    // A share without the thumbnail layer (an older client, a small source) would come at full size.
                    screen: !!screen && (own ? !ownShareHidden : !!screen.publication.simulcasted),
                    camera: hasCamera(p.identity),
                    shownLarge: focused?.track.participant.identity === p.identity,
                });
                return (
                    <FocusStripTile
                        key={p.identity}
                        active={p.identity === selectedIdentity}
                        avatarOnly={!content}
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
                            trackRef={content === 'screen' ? screen : content === 'camera' ? cameraMap.get(p.identity) : undefined}
                            audioMuted={p.identity === localParticipant.identity ? audioMuted : undefined}
                            avatarUrl={avatarCache?.get(p.identity)}
                        />
                    </FocusStripTile>
                );
            })}
        </FocusLayoutView>
    );
}

/** The focus layout's frame: the large view, a strip of everyone (`children`), what goes under them and an overlay such as a menu. */
export function FocusLayoutView({ main, overlay, below, children }: { main: ReactNode; overlay?: ReactNode; below?: ReactNode; children: ReactNode }) {
    return (
        <div className={`fl-area${below ? ' fl-area-below' : ''}`}>
            {main}
            <div className="fl-strip">{children}</div>
            {below && <div className="fl-below">{below}</div>}
            {overlay}
        </div>
    );
}

interface FocusStripTileProps {
    active: boolean;
    /** No video to show: phones draw them as a compact avatar. */
    avatarOnly: boolean;
    /** Set when clicking focuses this person, who has a screen or camera to show. */
    title?: string;
    onClick?: (e: React.MouseEvent) => void;
    onContextMenu?: (e: React.MouseEvent) => void;
    children: ReactNode;
}

/** One person in the side strip. */
export function FocusStripTile({ active, avatarOnly, title, onClick, onContextMenu, children }: FocusStripTileProps) {
    return (
        <div
            className={`fl-strip-tile${active ? ' fl-strip-active' : ''}${avatarOnly ? ' fl-strip-avatar' : ''}${title ? ' fl-strip-clickable' : ''}`}
            onClick={onClick}
            onContextMenu={onContextMenu}
            title={title}
        >
            {children}
        </div>
    );
}
