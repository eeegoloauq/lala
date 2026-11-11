import { useSyncExternalStore } from 'react';
import { createStore } from './store';

/** Whose profile card is open, and where; one at a time, from the sidebar or the call. */
export interface OpenProfile {
    identity: string;
    name: string;
    x: number;
    y: number;
}

const openProfileStore = createStore<OpenProfile | null>(null);

export const openProfile = (profile: OpenProfile | null) => openProfileStore.set(profile);
export const useOpenProfile = () => useSyncExternalStore(openProfileStore.subscribe, openProfileStore.get);
