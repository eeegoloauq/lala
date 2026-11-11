import { useState, useRef, useCallback, useId } from 'react';
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
    /** The accessible name: what the visible row label says. */
    label: string;
    className?: string;
    disabled?: boolean;
}

/**
 * A dropdown that every theme can style, which a native <select> doesn't allow for its
 * list. It follows the WAI-ARIA select-only combobox pattern: focus stays on the button,
 * which points at the highlighted option; arrows, Home and End move, Enter or Space
 * picks, Escape and Tab close.
 */
export function Select({ value, onChange, options, label, className = '', disabled = false }: SelectProps) {
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const [dropStyle, setDropStyle] = useState<React.CSSProperties>({});
    const rootRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const id = useId();
    const listId = `${id}-list`;
    const optionId = (i: number) => `${id}-option-${i}`;

    const selectedIndex = Math.max(0, options.findIndex(o => o.value === value));
    const selected = options[selectedIndex];

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
        setActive(selectedIndex);
        setOpen(true);
    }, [selectedIndex]);

    const close = useCallback(() => setOpen(false), []);
    useDismiss(rootRef, close, open);

    const pick = (i: number) => {
        const option = options[i];
        if (option) onChange(option.value);
        setOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        if (disabled || options.length === 0) return;
        const last = options.length - 1;
        const move = (i: number) => { e.preventDefault(); if (!open) openDropdown(); setActive(Math.min(last, Math.max(0, i))); };
        switch (e.key) {
            case 'ArrowDown': return open ? move(active + 1) : move(selectedIndex);
            case 'ArrowUp': return open ? move(active - 1) : move(selectedIndex);
            case 'Home': return move(0);
            case 'End': return move(last);
            case 'Enter':
            case ' ':
                e.preventDefault();
                if (open) pick(active); else openDropdown();
                return;
            case 'Escape':
                if (open) { e.preventDefault(); e.stopPropagation(); setOpen(false); }
                return;
            case 'Tab':
                setOpen(false);
                return;
        }
    };

    return (
        <div ref={rootRef} className={`lala-select${open ? ' open' : ''}${disabled ? ' disabled' : ''}${className ? ' ' + className : ''}`}>
            <button
                ref={triggerRef}
                className="lala-select-trigger"
                type="button"
                role="combobox"
                aria-label={label}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listId}
                aria-activedescendant={open ? optionId(active) : undefined}
                disabled={disabled}
                onClick={() => { if (disabled) return; if (open) setOpen(false); else openDropdown(); }}
                onKeyDown={handleKeyDown}
            >
                <span>{selected?.label ?? ''}</span>
                <svg className="lala-select-arrow" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            {open && (
                <div className="lala-select-dropdown" style={dropStyle} id={listId} role="listbox" aria-label={label}>
                    {options.map((opt, i) => (
                        <div
                            key={opt.value}
                            id={optionId(i)}
                            role="option"
                            aria-selected={opt.value === value}
                            className={`lala-select-option${opt.value === value ? ' selected' : ''}${i === active ? ' active' : ''}`}
                            onMouseEnter={() => setActive(i)}
                            onMouseDown={(e) => {
                                e.preventDefault(); // keep focus, prevent scroll-dismiss
                                pick(i);
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
