import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReceivedChatMessage } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { ParticipantTileView } from '../room/VideoGrid/ParticipantTile';
import { ControlBarView } from '../room/ControlBar/ControlBar';
import { FocusLayoutView, FocusStripTile } from '../room/FocusLayout/FocusLayout';
import { FocusMainView } from '../room/FocusLayout/FocusMain';
import { ChatPanel, DESKTOP_CHAT_QUERY } from '../room/ChatPanel/ChatPanel';
import type { ChatEntry } from '../room/ChatPanel/MessageList';
import type { AppSettings } from '../settings/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { getMyAvatar } from '../../lib/avatarUtils';
import { playChatSound, playJoinSound, playLeaveSound, playMuteSound, playUnmuteSound, playScreenShareStartSound, playScreenShareStopSound } from '../../lib/sounds';
import { setDeafenedInRoom, setLiveParticipants, setMutedInRoom, setSpeakingUsers } from '../../lib/roomStatusStore';
import { MY_IDENTITY, callState, enterRoom, leaveRoom, onRoomsChanged, setMyState } from './server';
import type { CallState } from './server';
import { fakeScreen } from './fakeScreen';
import { useDemoFocus } from './useDemoFocus';
import '../room/FocusLayout/focus-layout.css';
import '../room/VideoGrid/video-grid.css';
import './demo.css';

interface DemoCallProps {
    roomId: string;
    name: string;
    settings: AppSettings;
    onLeave: () => void;
}

/** Above this level (0-1 RMS) the visitor's own tile shows them speaking. */
const SPEAKING_LEVEL = 0.04;

const pick = <T,>(list: readonly T[]): T | undefined => list[Math.floor(Math.random() * list.length)];

/**
 * Stands in for the call in the demo build, which has no media server. It renders the
 * call's own components (tiles, control bar, chat) from simulated people; the visitor's
 * microphone, camera and screen work, but only on this page: nothing is sent anywhere.
 */
export default function DemoCall({ roomId, name, settings, onLeave }: DemoCallProps) {
    const { t } = useTranslation();
    const isDesktopChat = useMediaQuery(DESKTOP_CHAT_QUERY);
    const [call, setCall] = useState<CallState | null>(() => callState(roomId));
    const [speaking, setSpeaking] = useState<ReadonlySet<string>>(new Set());
    const [chatOpen, setChatOpen] = useState(false);
    // Mounted on first open, as in a call: the composer takes the focus when it mounts.
    const [chatMounted, setChatMounted] = useState(false);
    const [unread, setUnread] = useState(0);
    const [entries, setEntries] = useState<ChatEntry[]>([]);
    const mic = useLocalMedia(() => navigator.mediaDevices.getUserMedia({ audio: true }));
    const cam = useLocalMedia(() => navigator.mediaDevices.getUserMedia({ video: true }));
    const screen = useLocalMedia(() => navigator.mediaDevices.getDisplayMedia({ video: true }));
    const [deafened, setDeafened] = useState(false);
    const micLevelSpeaking = useSpeaking(mic.stream);

    // Effects below read the latest values without re-running for them.
    const latest = useRef({ settings, onLeave, chatOpen, t });
    useEffect(() => { latest.current = { settings, onLeave, chatOpen, t }; });

    // Your own leave plays the leave sound, as in a call.
    const leave = useCallback(() => {
        if (latest.current.settings.soundJoinLeave) playLeaveSound();
        latest.current.onLeave();
    }, []);

    const addEntry = useCallback((entry: ChatEntry) => setEntries(list => [...list, entry]), []);
    const addSystem = useCallback((text: string) => {
        addEntry({ kind: 'system', id: `${Date.now()}-${Math.random()}`, timestamp: Date.now(), text });
    }, [addEntry]);
    const receive = useCallback((from: { identity: string; name: string }, message: string) => {
        // MessageList reads only the sender's identity and name, so plain values stand in for a Participant.
        const msg: ReceivedChatMessage = { id: `${Date.now()}-${Math.random()}`, timestamp: Date.now(), message, from: from as unknown as Participant };
        addEntry({ kind: 'chat', msg });
        if (from.identity === MY_IDENTITY) return;
        if (latest.current.settings.soundChat) playChatSound();
        if (!latest.current.chatOpen) setUnread(n => n + 1);
    }, [addEntry]);

    // Joining: the room's people, sounds and notices as they come and go, the greeting.
    useEffect(() => {
        const { settings: s, t: tr } = latest.current;
        enterRoom(roomId, name);
        if (s.soundJoinLeave) playJoinSound();
        addSystem(tr('system.youJoined'));
        let previous = callState(roomId);
        const sync = () => {
            const next = callState(roomId);
            if (!next) { leave(); return; }
            const { settings: now, t: tl } = latest.current;
            const before = new Map(previous?.people.map(p => [p.identity, p.name]));
            const after = new Map(next.people.map(p => [p.identity, p.name]));
            for (const [id, n] of after) if (!before.has(id) && id !== MY_IDENTITY) {
                if (now.soundJoinLeave) playJoinSound();
                addSystem(tl('system.joined', { name: n }));
            }
            for (const [id, n] of before) if (!after.has(id) && id !== MY_IDENTITY) {
                if (now.soundJoinLeave) playLeaveSound();
                addSystem(tl('system.left', { name: n }));
            }
            for (const id of next.sharing) if (!previous?.sharing.has(id) && id !== MY_IDENTITY) {
                if (now.soundScreenShare) playScreenShareStartSound();
                addSystem(tl('system.screenShareStarted', { name: after.get(id) }));
            }
            for (const id of previous?.sharing ?? []) if (!next.sharing.has(id) && after.has(id) && id !== MY_IDENTITY) {
                if (now.soundScreenShare) playScreenShareStopSound();
                addSystem(tl('system.screenShareStopped', { name: after.get(id) }));
            }
            previous = next;
            setCall(next);
            // The sidebar reads the active room from these, as it does from LiveKit in a call.
            setLiveParticipants(after);
            setMutedInRoom(new Set(next.muted));
            setDeafenedInRoom(new Set(next.deafened));
        };
        sync();
        const unsubscribe = onRoomsChanged(sync);
        const greeting = setTimeout(() => {
            const someone = pick((callState(roomId)?.people ?? []).filter(p => p.identity !== MY_IDENTITY));
            if (someone) receive(someone, latest.current.t('demo.greeting', { name }));
        }, 2500);
        return () => { unsubscribe(); clearTimeout(greeting); leaveRoom(roomId); };
    }, [roomId, name, addSystem, receive, leave]);

    // Others take turns talking for a few seconds; the visitor's tile follows their own microphone.
    const callRef = useRef(call);
    useEffect(() => { callRef.current = call; }, [call]);
    useEffect(() => {
        const until = new Map<string, number>();
        const id = setInterval(() => {
            const now = Date.now();
            const c = callRef.current;
            const unmuted = (c?.people ?? []).filter(p => p.identity !== MY_IDENTITY && !c?.muted.has(p.identity) && !c?.serverMuted.has(p.identity));
            for (const [who, end] of until) if (end < now || !unmuted.some(p => p.identity === who)) until.delete(who);
            const quiet = unmuted.filter(p => !until.has(p.identity));
            const next = until.size < 2 && Math.random() < (until.size ? 0.15 : 0.5) ? pick(quiet) : undefined;
            if (next) until.set(next.identity, now + 1500 + Math.random() * 2500);
            setSpeaking(new Set(until.keys()));
        }, 500);
        return () => clearInterval(id);
    }, []);
    const micOn = !!mic.stream && !deafened;
    const speakingNow = new Set(speaking);
    if (micOn && micLevelSpeaking) speakingNow.add(MY_IDENTITY);
    const speakingKey = [...speakingNow].sort().join(',');
    useEffect(() => { setSpeakingUsers(speakingKey ? speakingKey.split(',') : []); }, [speakingKey]);

    useEffect(() => {
        setMyState(roomId, { muted: !micOn, deafened, sharing: !!screen.stream });
    }, [roomId, micOn, deafened, screen.stream]);

    const toggleMic = () => {
        if (deafened) return;
        if (settings.soundMicFeedback) (mic.stream ? playMuteSound : playUnmuteSound)();
        mic.toggle();
    };
    const toggleDeafen = () => {
        if (settings.soundMicFeedback) (deafened ? playUnmuteSound : playMuteSound)();
        setDeafened(d => !d);
    };
    const toggleChat = () => {
        setChatMounted(true);
        setChatOpen(open => !open);
        setUnread(0);
    };
    const send = async (message: string) => {
        receive({ identity: MY_IDENTITY, name }, message);
        const someone = pick((call?.people ?? []).filter(p => p.identity !== MY_IDENTITY));
        const replies = t('demo.replies', { returnObjects: true }) as string[];
        if (someone && Math.random() < 0.6) setTimeout(() => receive(someone, pick(replies) ?? '👍'), 1200 + Math.random() * 1800);
    };

    const people = call?.people ?? [];
    const myAvatar = getMyAvatar() ?? undefined;
    const remoteScreens = useFakeScreens(call, (who) => t('demo.screenOf', { name: who }));
    const screens = new Map(remoteScreens);
    if (screen.stream) screens.set(MY_IDENTITY, screen.stream);
    const cameras = new Map<string, MediaStream>(cam.stream ? [[MY_IDENTITY, cam.stream]] : []);
    const focus = useDemoFocus(screens, cameras);
    const nameOf = (identity: string) => people.find(p => p.identity === identity)?.name ?? name;

    const tileFor = (p: { identity: string; name: string }, video?: MediaStream, onClick?: () => void) => {
        const mine = p.identity === MY_IDENTITY;
        return (
            <ParticipantTileView
                name={p.name}
                identity={p.identity}
                avatarUrl={mine ? myAvatar : undefined}
                video={video ? <StreamVideo stream={video} mirror={mine} /> : undefined}
                speaking={speakingNow.has(p.identity)}
                screenSharing={screens.has(p.identity)}
                micMuted={mine ? !micOn : !!call?.muted.has(p.identity) || !!call?.serverMuted.has(p.identity)}
                serverMuted={!!call?.serverMuted.has(p.identity)}
                deafened={mine ? deafened : !!call?.deafened.has(p.identity)}
                handRaised={false}
                quality={mine ? null : 'excellent'}
                onClick={onClick}
            />
        );
    };
    const { focused, pip } = focus;
    const streamOf = (view: { identity: string; type: 'screen' | 'camera' }) => (view.type === 'screen' ? screens : cameras).get(view.identity)!;
    const stage = focus.active ? (
        <FocusLayoutView
            main={
                <FocusMainView
                    focused={focused && {
                        type: focused.type,
                        name: nameOf(focused.identity),
                        video: (ref) => <StreamVideo stream={streamOf(focused)} mirror={focused.type === 'camera'} videoRef={ref} />,
                    }}
                    pip={pip && { type: pip.type, video: <StreamVideo stream={streamOf(pip)} mirror={pip.type === 'camera'} /> }}
                    ambient={settings.ambientMode}
                    onSwap={focus.swap}
                    onExit={focus.exit}
                />
            }
        >
            {people.map(p => {
                const hasContent = screens.has(p.identity) || cameras.has(p.identity);
                return (
                    <FocusStripTile
                        key={p.identity}
                        active={p.identity === focused?.identity}
                        title={hasContent ? t('focus.focusOn', { name: p.name }) : undefined}
                        onClick={hasContent ? () => focus.pin(p.identity) : undefined}
                    >
                        {/* With both a screen and a camera on, the main view already shows their camera, large or as the PiP. */}
                        {tileFor(p, pip?.identity === p.identity ? undefined : cameras.get(p.identity))}
                    </FocusStripTile>
                );
            })}
        </FocusLayoutView>
    ) : (
        <div className="vg-area">
            <div className="vg-grid" data-count={String(Math.min(people.length, 9) || 1)}>
                {people.map(p => {
                    const camera = cameras.get(p.identity);
                    return <Fragment key={p.identity}>{tileFor(p, camera, camera ? () => focus.focusFromGrid(p.identity) : undefined)}</Fragment>;
                })}
            </div>
        </div>
    );
    const chat = (overlay: boolean) => (
        <ChatPanel
            entries={entries}
            send={send}
            isSending={false}
            localIdentity={MY_IDENTITY}
            mayChat
            overlay={overlay}
            onClose={() => setChatOpen(false)}
        />
    );

    return (
        <div className="demo-call">
            <div className="demo-call-note" role="note">{t('demo.callNote')}</div>
            <div className="cp-stage-row">
                <div className="cp-stage">{stage}</div>
                {isDesktopChat && <div className={`cp-dock${chatOpen ? ' cp-dock-open' : ''}`}>{chatMounted && chat(false)}</div>}
            </div>
            {!isDesktopChat && chatOpen && chat(true)}
            <div className="demo-call-bar">
                <ControlBarView
                    mic={{ enabled: micOn, pending: mic.pending, toggle: toggleMic }}
                    cam={{ enabled: !!cam.stream, pending: cam.pending, toggle: cam.toggle }}
                    screen={{ enabled: !!screen.stream, pending: screen.pending }}
                    audioMuted={deafened}
                    onToggleAudio={toggleDeafen}
                    chatOpen={chatOpen}
                    onToggleChat={toggleChat}
                    unreadCount={unread}
                    onScreenShareClick={screen.toggle}
                    onLeave={leave}
                    mayTalk mayScreenShare mayCamera
                    handRaised={false}
                    onToggleHand={() => {}}
                />
            </div>
        </div>
    );
}

/** A capture that stays on this page: started by toggle, stopped by toggle, unmount or the browser's own stop. */
function useLocalMedia(open: () => Promise<MediaStream>) {
    const [stream, setStream] = useState<MediaStream | null>(null);
    const [pending, setPending] = useState(false);
    const openRef = useRef(open);
    useEffect(() => {
        if (!stream) return;
        const ended = () => setStream(null);
        stream.getTracks().forEach(track => track.addEventListener('ended', ended));
        return () => stream.getTracks().forEach(track => { track.removeEventListener('ended', ended); track.stop(); });
    }, [stream]);
    const toggle = useCallback(() => {
        if (stream) { setStream(null); return; }
        setPending(true);
        openRef.current().then(setStream, err => console.warn('[DemoCall] Capture failed:', err instanceof Error ? err.message : err))
            .finally(() => setPending(false));
    }, [stream]);
    return { stream, pending, toggle };
}

/** Whether the microphone in `stream` hears speech now. */
function useSpeaking(stream: MediaStream | null): boolean {
    const [speaking, setSpeaking] = useState(false);
    useEffect(() => {
        if (!stream) return;
        const ctx = new AudioContext();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        const id = setInterval(() => {
            analyser.getFloatTimeDomainData(samples);
            const rms = Math.sqrt(samples.reduce((sum, v) => sum + v * v, 0) / samples.length);
            setSpeaking(rms > SPEAKING_LEVEL);
        }, 150);
        return () => { clearInterval(id); ctx.close(); setSpeaking(false); };
    }, [stream]);
    return speaking;
}

/** A local stream in a video element; `videoRef` also gets the element (the ambient glow reads it). */
function StreamVideo({ stream, mirror = false, videoRef }: { stream: MediaStream; mirror?: boolean; videoRef?: Ref<HTMLVideoElement> }) {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        if (ref.current) ref.current.srcObject = stream;
    }, [stream]);
    const setRef = useCallback((el: HTMLVideoElement | null) => {
        ref.current = el;
        if (typeof videoRef === 'function') videoRef(el);
        else if (videoRef) videoRef.current = el;
    }, [videoRef]);
    return <video ref={setRef} autoPlay muted playsInline style={mirror ? { transform: 'scaleX(-1)' } : undefined} />;
}

/** A generated screen for each simulated person who shares one, made when they start and stopped when they end. */
function useFakeScreens(call: CallState | null, labelFor: (name: string) => string): ReadonlyMap<string, MediaStream> {
    const [streams, setStreams] = useState<ReadonlyMap<string, MediaStream>>(new Map());
    const screensRef = useRef(new Map<string, { stream: MediaStream; stop: () => void }>());
    const sharers = [...(call?.sharing ?? [])].filter(id => id !== MY_IDENTITY);
    const key = sharers.sort().join(',');
    useEffect(() => {
        const screens = screensRef.current;
        const wanted = new Set(key ? key.split(',') : []);
        for (const [id, screen] of screens) if (!wanted.has(id)) { screen.stop(); screens.delete(id); }
        for (const id of wanted) if (!screens.has(id)) {
            const who = call?.people.find(p => p.identity === id)?.name ?? '';
            const hue = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
            screens.set(id, fakeScreen(labelFor(who), hue));
        }
        setStreams(new Map([...screens].map(([id, sc]) => [id, sc.stream])));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key]);
    useEffect(() => () => { screensRef.current.forEach(sc => sc.stop()); screensRef.current.clear(); }, []);
    return streams;
}
