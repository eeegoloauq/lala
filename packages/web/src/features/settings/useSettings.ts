import { useState } from 'react';
import { STORAGE_KEYS } from '../../lib/constants';
import { safeJsonParse } from '../../lib/utils';
import { DEFAULT_SETTINGS } from './types';
import type { AppSettings } from './types';

function loadSettings(): AppSettings {
  const parsed = safeJsonParse<Partial<AppSettings>>(localStorage.getItem(STORAGE_KEYS.settings), {});
  return { ...DEFAULT_SETTINGS, ...parsed };
}

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);

  const updateSettings = (patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(next));
      return next;
    });
  };

  return { settings, updateSettings };
}
