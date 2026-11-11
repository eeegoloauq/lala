import type { CSSProperties, ReactNode } from 'react';
import { useMediaQuery } from '../../../hooks/useMediaQuery';

const NARROW_QUERY = '(max-width: 640px)';

/** Columns for a number of people: wide screens go up to four, phones to two. */
function gridColumns(count: number, narrow: boolean): number {
    if (narrow) return count <= 2 ? 1 : 2;
    return count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
}

/**
 * The call's tiles, each 16:10 and as large as fits the stage both ways, so they never
 * turn into strips. The size itself is CSS (video-grid.css), from the column and row count.
 */
export function TileGrid({ count, children }: { count: number; children: ReactNode }) {
    const narrow = useMediaQuery(NARROW_QUERY);
    const cols = gridColumns(Math.max(count, 1), narrow);
    const rows = Math.ceil(Math.max(count, 1) / cols);
    return (
        <div className="vg-area">
            <div className="vg-grid" style={{ '--cols': cols, '--rows': rows } as CSSProperties}>
                {children}
            </div>
        </div>
    );
}
