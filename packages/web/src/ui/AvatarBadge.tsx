import './avatar-badge.css';

interface AvatarBadgeProps {
    children: React.ReactNode;
    /** Corner positions */
    topRight?: React.ReactNode;
    topLeft?: React.ReactNode;
    bottomRight?: React.ReactNode;
    bottomLeft?: React.ReactNode;
    /** Centered at top edge, slightly right of center — for crowns */
    topCrown?: React.ReactNode;
}

export function AvatarBadge({ children, topRight, topLeft, bottomRight, bottomLeft, topCrown }: AvatarBadgeProps) {
    return (
        <div className="avatar-badge-wrap">
            {children}
            {topRight    && <div className="avatar-badge avatar-badge--top-right">{topRight}</div>}
            {topLeft     && <div className="avatar-badge avatar-badge--top-left">{topLeft}</div>}
            {bottomRight && <div className="avatar-badge avatar-badge--bottom-right">{bottomRight}</div>}
            {bottomLeft  && <div className="avatar-badge avatar-badge--bottom-left">{bottomLeft}</div>}
            {topCrown    && <div className="avatar-badge avatar-badge--top-crown">{topCrown}</div>}
        </div>
    );
}
