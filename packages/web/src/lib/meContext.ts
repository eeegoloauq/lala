import { createContext, useContext } from 'react';
import type { Me } from './types';

/** Who this device is to the server; null until /api/me answers. Provided by App. */
export const MeContext = createContext<Me | null>(null);

export const useMeContext = () => useContext(MeContext);
