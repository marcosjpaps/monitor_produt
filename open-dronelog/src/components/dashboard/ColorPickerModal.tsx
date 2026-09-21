import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

const PRESET_COLORS = [
  '#7dd3fc', // light blue (default)
  '#f87171', // red
  '#fb923c', // orange
  '#facc15', // yellow
  '#4ade80', // green
  '#a78bfa', // violet
  '#f472b6', // pink
  '#94a3b8', // slate/gray
];

// Full palette of selectable colors (4 rows x 9 columns)
const COLOR_GRID = [
  // Row 1 - reds/oranges
  '#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#fed7aa', '#fdba74', '#fb923c', '#f59e0b',
  // Row 2 - yellows/greens
  '#facc15', '#fde047', '#bbf7d0', '#86efac', '#4ade80', '#22c55e', '#16a34a', '#15803d', '#065f46',
  // Row 3 - cyans/blues
  '#bae6fd', '#7dd3fc', '#38bdf8', '#0ea5e9', '#0284c7', '#1d4ed8', '#1e40af', '#312e81', '#475569',
  // Row 4 - purples/pinks
  '#e9d5ff', '#c4b5fd', '#a78bfa', '#8b5cf6', '#7c3aed', '#fce7f3', '#f9a8d4', '#f472b6', '#ec4899',
];

interface ColorPickerModalProps {
  isOpen: boolean;
  currentColor: string;
  onSelect: (color: string) => void;
  onClose: () => void;
  position?: {
    x: number;
    y: number;
    boundsLeft?: number;
    boundsRight?: number;
    centerHorizontally?: boolean;
  };
}

export default function ColorPickerModal({
  isOpen,
  currentColor,
  onSelect,
  onClose,
  position,
}: ColorPickerModalProps) {
  const { t } = useTranslation();
  const [selectedColor, setSelectedColor] = useState(currentColor || '#7dd3fc');
  const [customHex, setCustomHex] = useState(currentColor || '#7dd3fc');
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedColor(currentColor || '#7dd3fc');
      setCustomHex(currentColor || '#7dd3fc');
    }
  }, [isOpen, currentColor]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Use a tiny delay so the opening click doesn't immediately close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [isOpen, onClose]);

  const handleConfirm = useCallback(() => {
    onSelect(selectedColor);
    onClose();
  }, [selectedColor, onSelect, onClose]);

  const isValidHex = (hex: string) => /^#[0-9a-fA-F]{6}$/.test(hex);

  const handleCustomHexChange = (value: string) => {
    let hex = value;
    if (!hex.startsWith('#')) hex = '#' + hex;
    setCustomHex(hex);
    if (isValidHex(hex)) {
      setSelectedColor(hex.toLowerCase());
    }
  };

  if (!isOpen) return null;

  // Calculate position — opens upward from cursor, staying within viewport.
  // For sidebar usage, optionally center horizontally within provided sidebar bounds.
  const style: React.CSSProperties = {};
  if (position) {
    const modalW = 380;
    const modalH = 350;
    let modalMaxWidth = modalW;
    let left: number;

    if (
      position.centerHorizontally &&
      typeof position.boundsLeft === 'number' &&
      typeof position.boundsRight === 'number' &&
      position.boundsRight > position.boundsLeft
    ) {
      const horizontalInset = 12;
      const sidebarWidth = position.boundsRight - position.boundsLeft;
      const availableWidth = Math.max(0, sidebarWidth - horizontalInset * 2);
      const effectiveWidth = Math.max(0, Math.min(modalW, availableWidth));

      if (availableWidth > 0) {
        modalMaxWidth = availableWidth;
        left = position.boundsLeft + (sidebarWidth - effectiveWidth) / 2;
      } else {
        left = Math.max(8, Math.min(position.x, window.innerWidth - modalW - 8));
      }
    } else {
      left = Math.max(8, Math.min(position.x, window.innerWidth - modalW - 8));
    }

    // Open upward: place bottom edge at trigger y
    const top = Math.max(8, position.y - modalH);
    style.left = left;
    style.top = top;
    style.maxWidth = modalMaxWidth;
    style.width = 'calc(100vw - 16px)';
  } else {
    style.left = '50%';
    style.top = '50%';
    style.transform = 'translate(-50%, -50%)';
    style.width = 'calc(100vw - 16px)';
    style.maxWidth = 380;
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[10000] bg-black/30" onClick={onClose} />

      {/* Modal */}
      <div
        ref={modalRef}
        className="fixed z-[10001] rounded-xl border border-gray-700 bg-drone-surface shadow-2xl"
        style={style}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h3 className="text-sm font-medium text-gray-200">{t('flightList.editColor', 'Edit Color')}</h3>
          <button
            onClick={onClose}
            className="p-0.5 text-gray-400 hover:text-gray-200 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Preview */}
        <div className="px-4 pb-2 flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-lg border border-gray-600 shadow-inner flex-shrink-0"
            style={{ backgroundColor: selectedColor }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400">{t('flightList.selectedColor', 'Selected')}</p>
            <p className="text-sm text-gray-200 font-mono">{selectedColor.toUpperCase()}</p>
          </div>
        </div>

        {/* Quick preset colors */}
        <div className="px-4 pb-2">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">{t('flightList.presets', 'Quick Presets')}</p>
          <div className="flex gap-1.5 flex-wrap">
            {PRESET_COLORS.map((color) => (
              <button
                key={color}
                onClick={() => { setSelectedColor(color); setCustomHex(color); }}
                className={`w-7 h-7 rounded-md border-2 transition-all hover:scale-110 ${selectedColor === color
                  ? 'border-white shadow-lg shadow-white/20 scale-110'
                  : 'border-gray-600 hover:border-gray-400'
                  }`}
                style={{ backgroundColor: color }}
                title={color.toUpperCase()}
              />
            ))}
          </div>
        </div>

        {/* Color grid */}
        <div className="px-4 pb-2">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">{t('flightList.colorGrid', 'Color Grid')}</p>
          <div className="grid grid-cols-9 gap-1">
            {COLOR_GRID.map((color) => (
              <button
                key={color}
                onClick={() => { setSelectedColor(color); setCustomHex(color); }}
                className={`w-full aspect-square rounded border transition-all hover:scale-110 ${selectedColor === color
                  ? 'border-white shadow-lg shadow-white/20 scale-110 ring-1 ring-white'
                  : 'border-gray-700 hover:border-gray-500'
                  }`}
                style={{ backgroundColor: color }}
                title={color.toUpperCase()}
              />
            ))}
          </div>
        </div>

        {/* Custom hex input */}
        <div className="px-4 pb-3">
          <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">{t('flightList.customColor', 'Custom Hex')}</p>
          <div className="flex items-stretch gap-2">
            <div className="relative flex-1">
              <input
                type="text"
                value={customHex}
                onChange={(e) => handleCustomHexChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && isValidHex(customHex)) handleConfirm(); }}
                placeholder="#7dd3fc"
                maxLength={7}
                className={`input w-full text-xs h-8 px-3 font-mono ${!isValidHex(customHex) && customHex.length > 1 ? 'border-red-500' : ''}`}
              />
            </div>
            <input
              type="color"
              value={isValidHex(selectedColor) ? selectedColor : '#7dd3fc'}
              onChange={(e) => { setSelectedColor(e.target.value); setCustomHex(e.target.value); }}
              className="w-8 h-8 rounded border border-gray-600 cursor-pointer bg-transparent p-0"
              title={t('flightList.colorWheel', 'Color Wheel')}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 px-4 pb-3">
          <button
            onClick={handleConfirm}
            className="flex-1 h-8 text-xs font-medium rounded-lg bg-drone-primary text-white hover:bg-drone-primary/80 transition-colors"
          >
            {t('flightList.apply', 'Apply')}
          </button>
          <button
            onClick={onClose}
            className="flex-1 h-8 text-xs font-medium rounded-lg border border-gray-600 text-gray-300 hover:bg-gray-700 transition-colors"
          >
            {t('flightList.cancel')}
          </button>
        </div>
      </div>
    </>
  );
}
