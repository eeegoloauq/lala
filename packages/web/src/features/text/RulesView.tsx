import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { agreeToRules, useRules } from '../../lib/textChat';
import { ChatText } from '../../ui/ChatText';
import { useMeContext } from '../../lib/meContext';
import { APP_NAME } from '../../lib/constants';
import './text-chat.css';

/**
 * The server's rules, shown like a chat that nobody writes in. When the server asks for
 * agreement first, this is the only thing open until the visitor agrees; the server holds
 * back rooms and chats until then, so the button is not what keeps anyone out.
 */
export function RulesView({ onAgreed, compact = false }: { onAgreed?: () => void; /** In a call's side panel, which has its own header. */ compact?: boolean }) {
    const { t, i18n } = useTranslation();
    const rules = useRules();
    const server = useMeContext()?.serverName ?? APP_NAME;
    const [busy, setBusy] = useState(false);
    const [failed, setFailed] = useState(false);
    if (!rules) return null;
    const pending = rules.required && !rules.accepted;

    const agree = async () => {
        setBusy(true);
        setFailed(false);
        try {
            await agreeToRules();
            onAgreed?.();
        } catch {
            setFailed(true);
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className={`tc-view tc-rules${compact ? ' tc-view-compact' : ''}`} aria-label={t('rules.title')}>
            {!compact && (
                <header className="tc-header">
                    <h1 className="tc-header-name">{t('rules.title')}</h1>
                </header>
            )}
            {/* The same row as a chat message, written by the server itself. */}
            <div className="tc-list tc-rules-list">
                <div className="tc-msg">
                    <div className="tc-msg-gutter">
                        <span className="tc-avatar tc-avatar-server" aria-hidden>{server[0]?.toUpperCase()}</span>
                    </div>
                    <div className="tc-msg-body">
                        <div className="tc-msg-head">
                            <span className="tc-msg-name tc-msg-name-server">{server}</span>
                            {/* When the rules last changed: the date that asks everyone to agree again. */}
                            <time className="tc-msg-time" dateTime={new Date(rules.updatedAt).toISOString()} title={new Date(rules.updatedAt).toLocaleString()}>
                                {new Date(rules.updatedAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' })}
                            </time>
                        </div>
                        <div className="tc-msg-text"><ChatText text={rules.text} /></div>
                        {pending && (
                            <div className="tc-rules-agree">
                                <button type="button" className="btn btn-primary" onClick={agree} disabled={busy}>{t('rules.agree')}</button>
                                {failed && <span className="tc-rules-error" role="alert">{t('rules.failed')}</span>}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {/* Where a chat has its box: nobody writes in the rules. */}
            <div className="tc-composer">
                <div className="tc-readonly">{t('chat.rulesReadOnly')}</div>
            </div>
        </section>
    );
}
