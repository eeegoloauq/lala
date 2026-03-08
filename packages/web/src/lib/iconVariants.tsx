import type { IconVariant } from '../types/electron';

export interface IconVariantDef {
  id: IconVariant;
  labelKey: string;
  svg: JSX.Element;
}

export const ICON_VARIANTS: IconVariantDef[] = [
  {
    id: 'voice-wave',
    labelKey: 'settings.iconVoiceWave',
    svg: (
      <svg viewBox="0 0 128 128">
        <circle cx="64" cy="64" r="64" fill="#1e1e1e"/>
        <g fill="#fff">
          <rect x="24" y="48" width="12" height="32" rx="6"/>
          <rect x="40" y="36" width="12" height="56" rx="6"/>
          <rect x="58" y="25" width="12" height="78" rx="6"/>
          <rect x="76" y="36" width="12" height="56" rx="6"/>
          <rect x="92" y="48" width="12" height="32" rx="6"/>
        </g>
      </svg>
    ),
  },
  {
    id: 'dark-sphere',
    labelKey: 'settings.iconDarkSphere',
    svg: (
      <svg viewBox="0 0 128 128">
        <defs>
          <radialGradient id="ico-ds" cx="42%" cy="38%" r="60%">
            <stop offset="0%" stopColor="#282828"/>
            <stop offset="100%" stopColor="#111"/>
          </radialGradient>
        </defs>
        <circle cx="64" cy="64" r="62" fill="url(#ico-ds)"/>
        <path d="M52 34A30 30 0 0152 94A21 21 0 0052 34Z" fill="#fff" opacity=".95"/>
        <path d="M76 34A30 30 0 0076 94A21 21 0 0176 34Z" fill="#fff" opacity=".75"/>
      </svg>
    ),
  },
  {
    id: 'single-wave',
    labelKey: 'settings.iconSingleWave',
    svg: (
      <svg viewBox="0 0 128 128">
        <circle cx="64" cy="64" r="64" fill="#1e1e1e"/>
        <path d="M24 64C40 20,56 20,64 64C72 108,88 108,104 64" stroke="#fff" strokeWidth="19" fill="none" strokeLinecap="round"/>
      </svg>
    ),
  },
  {
    id: 'double-wave',
    labelKey: 'settings.iconDoubleWave',
    svg: (
      <svg viewBox="0 0 128 128">
        <circle cx="64" cy="64" r="64" fill="#1e1e1e"/>
        <path d="M22 58C38 16,54 16,64 58C74 100,90 100,106 58" stroke="#fff" strokeWidth="9" fill="none" strokeLinecap="round"/>
        <path d="M22 72C38 114,54 114,64 72C74 30,90 30,106 72" stroke="#fff" strokeWidth="9" fill="none" strokeLinecap="round" opacity=".55"/>
      </svg>
    ),
  },
];
