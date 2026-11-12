import { useCallback, useEffect, useRef, useState } from 'react';
import type { StagedFile } from './composerTools';

/** Raster pictures get a preview in the tray; anything else shows as a file card. */
const PREVIEWABLE = /^image\/(png|jpeg|gif|webp|avif)$/;
let nextId = 0;

export interface StagedFilesController {
    files: StagedFile[];
    add: (files: Iterable<File>) => void;
    remove: (id: string) => void;
    toggleSpoiler: (id: string) => void;
    /** Empties the tray for sending; `done` frees the previews, or puts the files back after a failure. */
    take: () => { files: StagedFile[]; done: (sent: boolean) => void };
}

/**
 * The composer's tray of files waiting for a message. Owned by the panel around the
 * composer, so a file dropped anywhere on it lands here too.
 */
export function useStagedFiles(): StagedFilesController {
    const [files, setFiles] = useState<StagedFile[]>([]);
    const filesRef = useRef(files);
    filesRef.current = files;

    useEffect(() => () => filesRef.current.forEach(f => f.preview && URL.revokeObjectURL(f.preview)), []);

    const add = useCallback((incoming: Iterable<File>) => {
        const next = Array.from(incoming, (file): StagedFile => ({
            id: `staged-${nextId++}`,
            file,
            spoiler: false,
            preview: PREVIEWABLE.test(file.type) ? URL.createObjectURL(file) : undefined,
        }));
        if (next.length) setFiles(current => [...current, ...next]);
    }, []);

    const remove = useCallback((id: string) => {
        setFiles(current => {
            const gone = current.find(f => f.id === id);
            if (gone?.preview) URL.revokeObjectURL(gone.preview);
            return current.filter(f => f.id !== id);
        });
    }, []);

    const toggleSpoiler = useCallback((id: string) => {
        setFiles(current => current.map(f => f.id === id ? { ...f, spoiler: !f.spoiler } : f));
    }, []);

    const take = useCallback(() => {
        const taken = filesRef.current;
        setFiles([]);
        return {
            files: taken,
            done: (sent: boolean) => {
                if (sent) taken.forEach(f => f.preview && URL.revokeObjectURL(f.preview));
                else setFiles(current => [...taken, ...current]);
            },
        };
    }, []);

    return { files, add, remove, toggleSpoiler, take };
}
