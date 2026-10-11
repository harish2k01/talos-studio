import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

export function ResourcePicker({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; name: string; detail?: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value);
  const visible = options.filter((o) =>
    `${o.name} ${o.detail || ''}`.toLowerCase().includes(search.toLowerCase()),
  );
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  return (
    <div
      className="resource-picker"
      ref={root}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          close();
        }
        if (open && ['ArrowDown', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          const items = [...(root.current?.querySelectorAll<HTMLElement>('input, [role=option]') || [])];
          const index = items.indexOf(document.activeElement as HTMLElement);
          items[(index + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setSearch('');
          setOpen(!open);
        }}
        className="picker-trigger"
      >
        <span>
          <strong>{selected?.name || 'Select a target'}</strong>
          {selected?.detail && <small>{selected.detail}</small>}
        </span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="picker-popover">
          <label className="picker-search">
            <Search size={15} />
            <input
              ref={input}
              aria-label={`Search ${label.toLowerCase()}`}
              placeholder="Search by name or address"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div role="listbox" aria-label={label}>
            {visible.map((o) => (
              <button
                role="option"
                aria-selected={value === o.value}
                key={o.value}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
              >
                <span>
                  <strong>{o.name}</strong>
                  <small>{o.detail}</small>
                </span>
                {value === o.value && <Check size={16} />}
              </button>
            ))}
          </div>
          {!visible.length && <p className="muted small">No matches</p>}
        </div>
      )}
    </div>
  );
}
