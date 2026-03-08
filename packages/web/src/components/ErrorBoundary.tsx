import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
    children: ReactNode;
    fallback?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    state: State = { hasError: false, error: null };

    static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        console.error('ErrorBoundary caught:', error, info.componentStack);
    }

    render() {
        if (this.state.hasError) {
            if (this.props.fallback) return this.props.fallback;
            return (
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100vh',
                    gap: '16px',
                    color: 'var(--text-primary, #e0e0e0)',
                    background: 'var(--bg-primary, #1a1a2e)',
                    fontFamily: 'system-ui, sans-serif',
                }}>
                    <h2 style={{ margin: 0 }}>Something went wrong</h2>
                    <p style={{ margin: 0, color: 'var(--text-muted, #888)', maxWidth: '400px', textAlign: 'center' }}>
                        {this.state.error?.message || 'An unexpected error occurred'}
                    </p>
                    <button
                        onClick={() => window.location.reload()}
                        style={{
                            padding: '8px 24px',
                            borderRadius: '8px',
                            border: 'none',
                            background: 'var(--accent, #7c3aed)',
                            color: '#fff',
                            cursor: 'pointer',
                            fontSize: '14px',
                        }}
                    >
                        Reload
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}
