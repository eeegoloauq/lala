import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getAccess, submitAccessPassword, ACCESS_REQUIRED_EVENT } from '../../lib/api';
import { ApiError } from '../../lib/types';
import './access-gate.css';

/** Shows the instance password screen when the server has LALA_ACCESS_PASSWORD set. */
export function AccessGate({ children }: { children: ReactNode }) {
    const { t } = useTranslation();
    const [state, setState] = useState<'checking' | 'locked' | 'open'>('checking');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        let active = true;
        // If the check itself fails, let the app render its own "server unavailable" state.
        getAccess()
            .then(s => active && setState(s.granted ? 'open' : 'locked'))
            .catch(() => active && setState('open'));
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
            const code = err instanceof ApiError ? err.code : 'server_error';
            if (code === 'wrong_password') setError(t('access.wrongPassword'));
            else if (code === 'rate_limited') {
                const minutes = Math.ceil(((err as ApiError).retryAfter ?? 60) / 60);
                setError(t('access.tooManyAttempts', { minutes }));
            } else setError(t('access.serverError'));
        } finally {
            setSubmitting(false);
        }
    };

    if (state === 'checking') return null;
    if (state === 'open') return children;

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
                {error && <div className="access-error" role="alert">{error}</div>}
                <button className="btn btn-primary" type="submit" disabled={!password || submitting}>
                    {t('access.submit')}
                </button>
            </form>
        </div>
    );
}
