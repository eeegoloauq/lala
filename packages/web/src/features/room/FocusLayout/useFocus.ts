import { useState, useEffect, useRef } from 'react';
import { useTracks, useParticipants, useLocalParticipant, isTrackReference } from '@livekit/components-react';
import type { TrackReferenceOrPlaceholder, TrackReference } from '@livekit/components-react';
import { Track } from 'livekit-client';
import { nextFocus } from './focusRules';
import type { FocusPin } from './focusRules';

const SCREEN_TRACKS = [Track.Source.ScreenShare];
const CAMERA_TRACKS = [Track.Source.Camera];

export interface FocusView {
    track: TrackReference;
    type: 'screen' | 'camera';
}

function asActiveTrack(ref: TrackReferenceOrPlaceholder | undefined): TrackReference | null {
    if (ref && isTrackReference(ref) && ref.publication.isSubscribed && !ref.publication.isMuted) {
        return ref;
    }
    return null;
}

/**
 * Decides whose screen or camera fills the focus view (the rules are in `nextFocus`); when
 * the focused person shows both, `swap` flips which one is large and which is the
 * picture-in-picture.
 */
export function useFocus(initialIdentity: string | null) {
    const participants = useParticipants();
    const screenTracks = useTracks(SCREEN_TRACKS);
    const cameraTracks = useTracks(CAMERA_TRACKS);
    const { localParticipant } = useLocalParticipant();
    const [selectedIdentity, setSelectedIdentity] = useState<string | null>(initialIdentity);
    // When the focused participant has BOTH an active screen share and camera, this
    // flips which one is shown big (screen, by default) vs. as the PiP overlay.
    const [preferCameraId, setPreferCameraId] = useState<string | null>(null);

    const screenMap = new Map<string, TrackReference>();
    for (const t of screenTracks) {
        const active = asActiveTrack(t);
        if (active) screenMap.set(active.participant.identity, active);
    }
    const cameraMap = new Map<string, TrackReferenceOrPlaceholder>();
    for (const t of cameraTracks) {
        cameraMap.set(t.participant.identity, t);
    }
    const activeCamera = (identity: string) => asActiveTrack(cameraMap.get(identity));

    const participantsRef = useRef(participants);
    useEffect(() => { participantsRef.current = participants; });

    // Manual pin: set when the user explicitly clicks a strip tile. Blocks auto-focus
    // from stealing the view until the pinned participant leaves, or (if they were
    // pinned while sharing) their share ends.
    const manualPinRef = useRef<FocusPin | null>(null);
    // Tracks screen-share identities seen on the previous run, so we can tell which
    // ones are brand new (for "newest share auto-focuses" below).
    const prevScreenKeysRef = useRef<Set<string>>(new Set());
    const mountedRef = useRef(false);

    const participantIds = participants.map((p) => p.identity).join(',');
    const screenKeys = [...screenMap.keys()].join(',');
    useEffect(() => {
        const fresh = participantsRef.current;
        const currentScreenIds = [...screenMap.keys()];
        const currentScreenSet = new Set(currentScreenIds);
        const prevScreenSet = prevScreenKeysRef.current;
        const isFirstRun = !mountedRef.current;
        mountedRef.current = true;
        // On mount, don't treat pre-existing shares as "newly appeared" — that would
        // override an explicit initialIdentity (e.g. focusing a specific camera tile).
        const newlyAppeared = isFirstRun ? [] : currentScreenIds.filter((id) => !prevScreenSet.has(id));
        prevScreenKeysRef.current = currentScreenSet;

        setSelectedIdentity((current) => {
            const next = nextFocus({
                current,
                pin: manualPinRef.current,
                own: localParticipant.identity,
                shares: currentScreenSet,
                appeared: newlyAppeared,
                ended: [...prevScreenSet].filter((id) => !currentScreenSet.has(id)),
                isPresent: (id) => fresh.some((p) => p.identity === id),
                fallback: initialIdentity ?? fresh[0]?.identity ?? null,
            });
            manualPinRef.current = next.pin;
            return next.selected;
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [participantIds, screenKeys]);

    // Reset the camera/screen swap preference whenever the focused participant changes —
    // it's meaningless carried over to someone else.
    useEffect(() => {
        setPreferCameraId(null);
    }, [selectedIdentity]);

    // ...and when the preferred participant's share or camera ends.
    const activeCameraKeys = [...cameraMap.keys()].filter(activeCamera).join(',');
    useEffect(() => {
        setPreferCameraId((current) => current && screenMap.has(current) && activeCamera(current) ? current : null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [screenKeys, activeCameraKeys]);

    // Main view: the selected person's screen share, else their camera; with both,
    // `preferCameraId` swaps them. Without a selection, the first screen share.
    let focused: FocusView | null = null;
    if (selectedIdentity) {
        const screen = screenMap.get(selectedIdentity);
        const cam = activeCamera(selectedIdentity);
        if (screen && cam && preferCameraId === selectedIdentity) focused = { track: cam, type: 'camera' };
        else if (screen) focused = { track: screen, type: 'screen' };
        else if (cam) focused = { track: cam, type: 'camera' };
    }
    if (!focused) {
        const firstScreen = screenMap.values().next().value;
        if (firstScreen) focused = { track: firstScreen, type: 'screen' };
    }

    // Picture-in-picture: whichever of screen/camera isn't the main view, for the same
    // participant — only when they have both active at once.
    let pip: FocusView | null = null;
    if (focused) {
        const identity = focused.track.participant.identity;
        const other = focused.type === 'screen' ? activeCamera(identity) : screenMap.get(identity);
        if (other) pip = { track: other, type: focused.type === 'screen' ? 'camera' : 'screen' };
    }

    return {
        participants,
        cameraMap,
        selectedIdentity,
        focused,
        pip,
        hasScreenShare: (identity: string) => screenMap.has(identity),
        hasCamera: (identity: string) => !!activeCamera(identity),
        /** Focuses someone by hand; auto-focus leaves them alone until they leave or stop sharing. */
        pin: (identity: string) => {
            manualPinRef.current = { identity, wasSharing: screenMap.has(identity) };
            setSelectedIdentity(identity);
        },
        /** Swaps the main view and the picture-in-picture (and back on a second call). */
        swap: () => {
            if (!focused) return;
            const identity = focused.track.participant.identity;
            setPreferCameraId((current) => (current === identity ? null : identity));
        },
    };
}
