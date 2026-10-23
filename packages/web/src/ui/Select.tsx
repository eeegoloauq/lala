import { useState, useRef, useCallback } from 'react';
import { useDismiss } from '../hooks/useDismiss';
import './select.css';

export interface SelectOption {
    value: string;
    label: string;
}

interface SelectProps {
    value: string;
    onChange: (value: string) => void;
    options: SelectOption[];
    className?: string;
    disabled?: boolean;
}

export function Select({ value, onChange, options, className = '', disabled = false }: SelectProps) {
    const [open, setOpen] = useState(false);
    const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

    const selected = options.find(o => o.value === value);

    const openDropdown = useCallback(() => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        setDropStyle({
            position: 'fixed',
            top: rect.bottom + 4,
            left: rect.left,
            width: rect.width,
            zIndex: 9999,
        });
        setOpen(true);
    }, []);

    const close = useCallback(() => setOpen(false), []);
    useDismiss(rootRef, close, open);

    return (
        <div ref={rootRef} className={`lala-select${open ? ' open' : ''}${disabled ? ' disabled' : ''}${className ? ' ' + className : ''}`}>
            <button
                ref={triggerRef}
                className="lala-select-trigger"
                type="button"
                disabled={disabled}
                onClick={() => { if (disabled) return; if (open) setOpen(false); else openDropdown(); }}
            >
                <span>{selected?.label ?? ''}</span>
                <svg className="lala-select-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            {open && (
                <div className="lala-select-dropdown" style={dropStyle}>
                    {options.map(opt => (
                        <div
                            key={opt.value}
                            className={`lala-select-option${opt.value === value ? ' selected' : ''}`}
                            onMouseDown={(e) => {
                                e.preventDefault(); // keep focus, prevent scroll-dismiss
                                onChange(opt.value);
                                setOpen(false);
                            }}
                        >
                            {opt.label}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
