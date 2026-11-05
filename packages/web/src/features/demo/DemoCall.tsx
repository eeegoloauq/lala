import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ReceivedChatMessage } from '@livekit/components-react';
import type { Participant } from 'livekit-client';
import { ParticipantTileView } from '../room/VideoGrid/ParticipantTile';
import { ControlBarView } from '../room/ControlBar/ControlBar';
import { ChatPanel, DESKTOP_CHAT_QUERY } from '../room/ChatPanel/ChatPanel';
import type { ChatEntry } from '../room/ChatPanel/MessageList';
import type { AppSettings } from '../settings/types';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { getMyAvatar } from '../../lib/avatarUtils';
import { playChatSound, playJoinSound, playLeaveSound, playMuteSound, playUnmuteSound, playScreenShareStartSound, playScreenShareStopSound } from '../../lib/sounds';
import { setDeafenedInRoom, setLiveParticipants, setMutedInRoom, setSpeakingUsers } from '../../lib/roomStatusStore';
import { MY_IDENTITY, callState, enterRoom, leaveRoom, onRoomsChanged, setMyState } from './server';
import type { CallState } from './server';
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
            if (!next) { latest.current.onLeave(); return; }
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
    }, [roomId, name, addSystem, receive]);

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
    const tiles = (
        <div className="vg-area">
            <div className="vg-grid" data-count={String(Math.min(people.length + (screen.stream ? 1 : 0), 9) || 1)}>
                {screen.stream && (
                    <ParticipantTileView
                        name={name} identity={MY_IDENTITY} video={<StreamVideo stream={screen.stream} />}
                        speaking={false} screenSharing micMuted={false} serverMuted={false} deafened={false} handRaised={false} quality={null}
                    />
                )}
                {people.map(p => {
                    const mine = p.identity === MY_IDENTITY;
                    return (
                        <ParticipantTileView
                            key={p.identity}
                            name={p.name}
                            identity={p.identity}
                            avatarUrl={mine ? myAvatar : undefined}
                            video={mine && cam.stream ? <StreamVideo stream={cam.stream} mirror /> : undefined}
                            speaking={speakingNow.has(p.identity)}
                            screenSharing={mine ? !!screen.stream : !!call?.sharing.has(p.identity)}
                            micMuted={mine ? !micOn : !!call?.muted.has(p.identity) || !!call?.serverMuted.has(p.identity)}
                            serverMuted={!!call?.serverMuted.has(p.identity)}
                            deafened={mine ? deafened : !!call?.deafened.has(p.identity)}
                            handRaised={false}
                            quality={mine ? null : 'excellent'}
                        />
                    );
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
                <div className="cp-stage">{tiles}</div>
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
                    onLeave={onLeave}
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

function StreamVideo({ stream, mirror = false }: { stream: MediaStream; mirror?: boolean }) {
    const ref = useRef<HTMLVideoElement>(null);
    useEffect(() => {
        if (ref.current) ref.current.srcObject = stream;
    }, [stream]);
    return <video ref={ref} autoPlay muted playsInline style={mirror ? { transform: 'scaleX(-1)' } : undefined} />;
}
