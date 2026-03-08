import { colorForName } from '../../../lib/participantColor';

interface AvatarProps {
    name: string;
    identity?: string;
    size?: number;
    avatarUrl?: string;
}

export function Avatar({ name, identity, size = 36, avatarUrl }: AvatarProps) {
    const color = colorForName(identity || name);
    const initial = (name || '?')[0].toUpperCase();

    return (
        <div className="p-avatar">
            <div
                className="p-avatar-circle"
                style={{
                    width: size,
                    height: size,
                    fontSize: size * 0.38,
                    background: avatarUrl ? undefined : `radial-gradient(circle at 35% 35%, ${color}dd, ${color}77)`,
                    overflow: avatarUrl ? 'hidden' : undefined,
                }}
            >
                {avatarUrl
                    ? <img src={avatarUrl} alt={name} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                    : initial
                }
            </div>
        </div>
    );
}
