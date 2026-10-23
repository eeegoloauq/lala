import type { CSSProperties, ReactNode } from 'react';

/** Stroke-based icons shared across the app; defaults suit the control bar. */
interface IconProps {
    size?: number;
    strokeWidth?: number;
    className?: string;
    style?: CSSProperties;
}

function Svg({ size = 20, strokeWidth = 1.8, className, style, children }: IconProps & { children: ReactNode }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            style={style}
        >
            {children}
        </svg>
    );
}

export function MicIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <rect x="9" y="2" width="6" height="12" rx="3" />
            <path d="M5 11a7 7 0 0014 0" />
            <line x1="12" y1="20" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
        </Svg>
    );
}

export function MicOffIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 005.12 2.12M15 9.34V4a3 3 0 00-5.94-.6" />
            <path d="M17 16.95A7 7 0 015 11v-1m14 0v1c0 .68-.1 1.34-.27 1.96" />
            <line x1="12" y1="20" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
        </Svg>
    );
}

export function VideoIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <polygon points="23 7 16 12 23 17 23 7" />
            <rect x="1" y="5" width="15" height="14" rx="2" />
        </Svg>
    );
}

export function VideoOffIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M16 16v1a2 2 0 01-2 2H3a2 2 0 01-2-2V7a2 2 0 012-2h2m5.66 0H14a2 2 0 012 2v3.34l1 1L23 7v10" />
            <line x1="1" y1="1" x2="23" y2="23" />
        </Svg>
    );
}

export function ScreenShareIcon(props: IconProps) {
    return (
        <Svg {...props} size={props.size ?? 24}>
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
            <polyline points="9 9 12 6 15 9" />
            <line x1="12" y1="6" x2="12" y2="13" />
        </Svg>
    );
}

export function ScreenShareStatusIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
        </Svg>
    );
}

export function ScreenShareOffIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
            <line x1="1" y1="1" x2="23" y2="23" />
        </Svg>
    );
}

export function ChatIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
        </Svg>
    );
}

export function SpeakerIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M15.54 8.46a5 5 0 010 7.07" />
            <path d="M19.07 4.93a10 10 0 010 14.14" />
        </Svg>
    );
}

export function SpeakerOffIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <line x1="1" y1="1" x2="23" y2="23" />
        </Svg>
    );
}

export function PhoneOffIcon(props: IconProps) {
    // Horizontal handset — no slash needed, red button style conveys "end call"
    return (
        <Svg {...props}>
            <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07C9.44 17.29 7.76 15.63 6.53 13.7A19.79 19.79 0 013.46 5.07 2 2 0 015.44 3h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L9.41 10.6" />
        </Svg>
    );
}

export function SettingsIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </Svg>
    );
}

export function MoonIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </Svg>
    );
}

export function RenameIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </Svg>
    );
}


export function LockIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </Svg>
    );
}

export function FlipCameraIcon(props: IconProps) {
    return (
        <Svg {...props}>
            <path d="M20 7h-3.5l-1.5-2h-6L7.5 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z" />
            <circle cx="12" cy="13" r="3.5" />
            <path d="M17 4l2 3-2 3" />
        </Svg>
    );
}
