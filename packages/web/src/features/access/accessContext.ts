import { createContext, useContext } from 'react';

export const AccessRequiredContext = createContext(false);

/** Whether the server has a password, so an invite link has to carry an invite. */
export const useAccessRequired = () => useContext(AccessRequiredContext);
