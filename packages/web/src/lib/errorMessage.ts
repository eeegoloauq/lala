import type { TFunction } from 'i18next';
import { ApiError } from './types';

// Codes people run into, in words; anything else shows its code.
const KNOWN = ['rate_limited', 'not_allowed', 'banned', 'forbidden', 'server_unavailable'] as const;

/** What to tell the user about a failed API call. */
export function errorMessage(t: TFunction, err: unknown): string {
    const code = err instanceof ApiError ? err.code : 'server_error';
    return (KNOWN as readonly string[]).includes(code) ? t(`errors.${code}`) : t('room.errorCode', { code });
}
