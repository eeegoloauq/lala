import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getAccess, submitAccessPassword, submitAccessInvite, ACCESS_REQUIRED_EVENT } from '../../lib/api';
import { ApiError } from '../../lib/types';
import { AccessRequiredContext } from './accessContext';
import './access-gate.css';

/** Takes `invite` out of the URL fragment and leaves the rest (a room password) to the router. */
function takeInviteFromHash(): string | null {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const invite = params.get('invite');
    if (invite === null) return null;
    params.delete('invite');
    const rest = params.toString();
    window.history.replaceState(null, '', window.location.pathname + (rest ? `#${rest}` : ''));
    return invite;
}

// Read once at load rather than in an effect, which can run twice.
const inviteFromUrl = takeInviteFromHash();

function errorText(err: unknown, t: TFunction): string {
    const code = err instanceof ApiError ? err.code : 'server_error';
    if (code === 'wrong_password') return t('access.wrongPassword');
    if (code === 'invalid_invite') return t('access.inviteExpired');
    if (code === 'rate_limited') {
        return t('access.tooManyAttempts', { minutes: Math.ceil(((err as ApiError).retryAfter ?? 60) / 60) });
    }
    return t('access.serverError');
}

/** Shows the instance password screen when the server has LALA_ACCESS_PASSWORD set. */
export function AccessGate({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');
    const [required, setRequired] = useState(false);
    const [password, setPassword] = useState('');
    const [error, setError] = useState<unknown>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let active = true;
        const check = async () => {
            const status = await getAccess();
            if (!active) return;
            setRequired(status.required);
            if (status.granted || !inviteFromUrl) {
                setState(status.granted ? 'open' : 'locked');
                return;
            }
            try {
                await submitAccessInvite(inviteFromUrl);
                if (active) setState('open');
            } catch (err) {
                if (!active) return;
                setError(err);
                setState('locked');
            }
        };
        // If the check itself fails, let the app render its own "server unavailable" state.
        check().catch(() => active && setState('open'));
        const lock = () => setState('locked');
        window.addEventListener(ACCESS_REQUIRED_EVENT, lock);
        return () => {
            active = false;
            window.removeEventListener(ACCESS_REQUIRED_EVENT, lock);
        };
    }, []);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!password || submitting) return;
        setSubmitting(true);
        setError(null);
        try {
            await submitAccessPassword(password);
            setPassword('');
            setState('open');
        } catch (err) {
            setError(err);
        } finally {
            setSubmitting(false);
        }
    };

    if (state === 'checking') return null;
    if (state === 'open') return <AccessRequiredContext.Provider value={required}>{children}</AccessRequiredContext.Provider>;

    return (
        <div className="app-layout" style={{ justifyContent: 'center', alignItems: 'center' }}>
            <form className="home-card" onSubmit={handleSubmit}>
                <div className="sidebar-header" style={{ border: 'none', justifyContent: 'center', marginBottom: '16px' }}>
                    <span className="logo" style={{ fontSize: '32px' }}>lala</span>
                </div>
                <p>{t('access.prompt')}</p>
                <div className="input-group">
                    <input
                        className="input"
                        type="password"
                        autoComplete="current-password"
                        placeholder={t('access.placeholder')}
                        aria-label={t('access.placeholder')}
                        autoFocus
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                    />
                </div>
                {error != null && <div className="access-error" role="alert">{errorText(error, t)}</div>}
                <button className="btn btn-primary" type="submit" disabled={!password || submitting}>
                    {t('access.submit')}
                </button>
            </form>
        </div>
    );
}
