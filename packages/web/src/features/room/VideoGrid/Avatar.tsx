import { avatarColorForIdentity } from '../../../lib/avatarUtils';

interface AvatarProps {
    name: string;
    identity?: string;
    /** Pixels, or 'fluid' to scale with the enclosing tile (see video-grid.css). */
    size?: number | 'fluid';
    avatarUrl?: string;
}

export function Avatar({ name, identity, size = 36, avatarUrl }: AvatarProps) {
    const color = avatarColorForIdentity(identity || name);
    const initial = (name || '?')[0].toUpperCase();

    return (
        <div className="p-avatar">
            <div
                className={`p-avatar-circle${size === 'fluid' ? ' p-avatar-fluid' : ''}`}
                style={{
                    ...(size === 'fluid' ? {} : { width: size, height: size, fontSize: size * 0.38 }),
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
