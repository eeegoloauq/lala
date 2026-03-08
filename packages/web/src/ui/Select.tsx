import { useState, useRef, useEffect, useCallback } from 'react';
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
}

export function Select({ value, onChange, options, className = '' }: SelectProps) {
    const [open, setOpen] = useState(false);
    const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
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

    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (triggerRef.current && !triggerRef.current.closest('.lala-select')?.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const keyHandler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setOpen(false);
        };
        // Use mousedown so scroll events don't bubble as false closes
        document.addEventListener('mousedown', handler);
        document.addEventListener('keydown', keyHandler);
        return () => {
            document.removeEventListener('mousedown', handler);
            document.removeEventListener('keydown', keyHandler);
        };
    }, [open]);

    return (
        <div className={`lala-select${open ? ' open' : ''}${className ? ' ' + className : ''}`}>
            <button
                ref={triggerRef}
                className="lala-select-trigger"
                type="button"
                onClick={() => open ? setOpen(false) : openDropdown()}
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
