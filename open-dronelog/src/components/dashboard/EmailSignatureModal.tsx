/**
 * Email Signature Generator Modal
 * Generates a modern pilot badge email signature with flight stats
 * Supports PNG download and HTML copy for email clients
 */

import { useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { isWebMode, saveBlobWithDialog } from '@/lib/api';
import { useFlightStore } from '@/stores/flightStore';
import logoIcon from '@/assets/icon.png';

interface EmailSignatureModalProps {
  totalFlights: number;
  totalDurationSecs: number;
  totalPhotos: number;
  totalVideos: number;
  currentRank: string;
  onClose: () => void;
}

const ACCENT_PRESETS = [
  { name: 'Cyan', value: '#06b6d4' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#10b981' },
  { name: 'Purple', value: '#8b5cf6' },
  { name: 'Orange', value: '#f59e0b' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Pink', value: '#ec4899' },
  { name: 'Slate', value: '#64748b' },
];

/** Convert a hex color to r,g,b components */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 6, g: 182, b: 212 };
}

/** Darken a hex color by a percentage */
function darkenHex(hex: string, percent: number): string {
  const { r, g, b } = hexToRgb(hex);
  const factor = 1 - percent / 100;
  const dr = Math.round(r * factor);
  const dg = Math.round(g * factor);
  const db = Math.round(b * factor);
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}

/** Create a composited image: logo centered on a white circle, returned as base64 PNG */
async function createCircleLogoBase64(url: string, circleSize = 28, logoSize = 20): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const px = 2; // 2x for retina sharpness
      const canvas = document.createElement('canvas');
      canvas.width = circleSize * px;
      canvas.height = circleSize * px;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(px, px);
        // Draw white circle
        ctx.beginPath();
        ctx.arc(circleSize / 2, circleSize / 2, circleSize / 2, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        // Draw logo centered on the circle
        const offset = (circleSize - logoSize) / 2;
        ctx.drawImage(img, offset, offset, logoSize, logoSize);
        resolve(canvas.toDataURL('image/png'));
      } else {
        resolve(url);
      }
    };
    img.onerror = () => resolve(url);
    img.src = url;
  });
}

/**
 * Generate the email-ready HTML signature string
 * Compact single-row badge, entire thing is a link
 */
function generateSignatureHtml(
  accentColor: string,
  totalFlights: number,
  totalHours: string,
  rank: string,
  logoBase64: string,
): string {
  const darkAccent = darkenHex(accentColor, 25);

  return `<a href="https://opendronelog.com" target="_blank" style="text-decoration:none;color:inherit;display:inline-block;">
<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;border-radius:8px;overflow:hidden;">
  <tr>
    <td style="background:#ffffff;padding:8px 16px;vertical-align:middle;text-align:center;">
      <div style="color:${accentColor};font-size:18px;font-weight:800;line-height:1.3;">${totalFlights}</div>
      <div style="color:#64748b;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;line-height:1.2;">Flights</div>
    </td>
    <td style="background:linear-gradient(135deg,${darkAccent},${accentColor});padding:8px 14px;vertical-align:middle;">
      <table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;width:28px;">
            <img src="${logoBase64}" alt="Open DroneLog" width="28" height="28" style="display:block;border:0;" />
          </td>
          <td style="vertical-align:middle;padding-left:8px;">
            <div style="color:#ffffff;font-size:11px;font-weight:700;letter-spacing:0.5px;line-height:1.3;">DRONE PILOT</div>
            <div style="color:rgba(255,255,255,0.75);font-size:9px;font-weight:500;letter-spacing:0.3px;line-height:1.3;">${rank}</div>
          </td>
        </tr>
      </table>
    </td>
    <td style="background:#ffffff;padding:8px 16px;vertical-align:middle;text-align:center;">
      <div style="color:${accentColor};font-size:18px;font-weight:800;line-height:1.3;">${totalHours}</div>
      <div style="color:#64748b;font-size:8px;font-weight:600;text-transform:uppercase;letter-spacing:0.8px;line-height:1.2;">Hours</div>
    </td>
  </tr>
  <tr>
    <td colspan="3" style="background:#f8fafc;padding:5px 12px 7px;text-align:center;border-top:1px solid #e2e8f0;">
      <span style="color:#94a3b8;font-size:8px;letter-spacing:0.3px;">Powered by </span>
      <span style="color:${accentColor};font-size:8px;font-weight:600;letter-spacing:0.3px;">opendronelog.com</span>
    </td>
  </tr>
</table>
</a>`;
}

export function EmailSignatureModal({
  totalFlights,
  totalDurationSecs,
  currentRank,
  onClose,
}: EmailSignatureModalProps) {
  const { t } = useTranslation();
  const themeMode = useFlightStore((state) => state.themeMode);
  const [accentColor, setAccentColor] = useState('#06b6d4');
  const [customColor, setCustomColor] = useState('#06b6d4');
  const [copied, setCopied] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [logoBase64, setLogoBase64] = useState<string>('');
  const previewRef = useRef<HTMLDivElement>(null);

  const resolvedTheme = useMemo(() => {
    if (themeMode === 'system') {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return themeMode;
  }, [themeMode]);
  const isLight = resolvedTheme === 'light';

  // Create composited circle-logo on mount for email embedding
  useEffect(() => {
    createCircleLogoBase64(logoIcon).then(setLogoBase64);
  }, []);

  // Format total hours
  const totalHours = useMemo(() => {
    const hrs = totalDurationSecs / 3600;
    return hrs >= 1 ? `${hrs.toFixed(1)}` : `${(hrs * 60).toFixed(0)}m`;
  }, [totalDurationSecs]);

  const darkAccent = darkenHex(accentColor, 25);

  // Handle escape key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Copy HTML signature to clipboard
  const handleCopyHtml = useCallback(async () => {
    if (!logoBase64) return;
    const html = generateSignatureHtml(accentColor, totalFlights, totalHours, currentRank, logoBase64);
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([html], { type: 'text/plain' }),
        }),
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Fallback: copy as plain text
      try {
        await navigator.clipboard.writeText(html);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      } catch (err) {
        console.error('Failed to copy signature:', err);
      }
    }
  }, [accentColor, totalFlights, totalHours, currentRank, logoBase64]);

  // Download as PNG — draw directly with Canvas 2D API
  // (html2canvas hangs/offsets when rendering elements inside fixed/scrollable modals)
  const handleDownloadPng = useCallback(async () => {
    if (!logoBase64) return;
    setIsExporting(true);
    try {
      const scale = 2; // 2x for retina quality
      const darkAccentVal = darkenHex(accentColor, 25);

      // --- Measure text to compute layout ---
      const mc = document.createElement('canvas').getContext('2d')!;

      mc.font = 'bold 18px Arial, Helvetica, sans-serif';
      const flightsNumW = mc.measureText(String(totalFlights)).width;
      const hoursNumW = mc.measureText(totalHours).width;

      mc.font = '600 8px Arial, Helvetica, sans-serif';
      const flightsLblW = mc.measureText('FLIGHTS').width;
      const hoursLblW = mc.measureText('HOURS').width;

      mc.font = 'bold 11px Arial, Helvetica, sans-serif';
      const titleW = mc.measureText('DRONE PILOT').width;
      mc.font = '500 9px Arial, Helvetica, sans-serif';
      const rankW = mc.measureText(currentRank).width;
      const titleBlockW = Math.max(titleW, rankW);

      // Cell sizing
      const px = 16, pxC = 14, py = 8, logoSz = 28, logoGap = 8;
      const flightsW = px + Math.max(flightsNumW, flightsLblW) + px;
      const centerW = pxC + logoSz + logoGap + titleBlockW + pxC;
      const hoursW = px + Math.max(hoursNumW, hoursLblW) + px;
      const totalW = flightsW + centerW + hoursW;
      const topH = py + Math.max(logoSz, 24) + py;
      const botH = 22;
      const totalH = topH + botH;
      const cornerR = 8;

      // --- Create canvas ---
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(totalW * scale);
      canvas.height = Math.ceil(totalH * scale);
      const ctx = canvas.getContext('2d')!;
      ctx.scale(scale, scale);

      // Clip to rounded rect
      ctx.beginPath();
      ctx.moveTo(cornerR, 0);
      ctx.lineTo(totalW - cornerR, 0);
      ctx.quadraticCurveTo(totalW, 0, totalW, cornerR);
      ctx.lineTo(totalW, totalH - cornerR);
      ctx.quadraticCurveTo(totalW, totalH, totalW - cornerR, totalH);
      ctx.lineTo(cornerR, totalH);
      ctx.quadraticCurveTo(0, totalH, 0, totalH - cornerR);
      ctx.lineTo(0, cornerR);
      ctx.quadraticCurveTo(0, 0, cornerR, 0);
      ctx.closePath();
      ctx.clip();

      // --- Flights cell ---
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, flightsW, topH);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fCx = flightsW / 2;
      ctx.fillStyle = accentColor;
      ctx.font = 'bold 18px Arial, Helvetica, sans-serif';
      ctx.fillText(String(totalFlights), fCx, topH / 2 - 6);
      ctx.fillStyle = '#64748b';
      ctx.font = '600 8px Arial, Helvetica, sans-serif';
      ctx.fillText('FLIGHTS', fCx, topH / 2 + 9);

      // --- Center cell (gradient) ---
      const cX = flightsW;
      const grad = ctx.createLinearGradient(cX, 0, cX + centerW, topH);
      grad.addColorStop(0, darkAccentVal);
      grad.addColorStop(1, accentColor);
      ctx.fillStyle = grad;
      ctx.fillRect(cX, 0, centerW, topH);

      // Logo image (already composited with white circle)
      const logoImg = new Image();
      logoImg.src = logoBase64;
      await new Promise<void>((r) => { if (logoImg.complete) { r(); return; } logoImg.onload = () => r(); logoImg.onerror = () => r(); });
      const lx = cX + pxC;
      const ly = (topH - logoSz) / 2;
      ctx.drawImage(logoImg, lx, ly, logoSz, logoSz);

      // Title text
      const tx = lx + logoSz + logoGap;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 11px Arial, Helvetica, sans-serif';
      ctx.fillText('DRONE PILOT', tx, topH / 2 - 5);
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.font = '500 9px Arial, Helvetica, sans-serif';
      ctx.fillText(currentRank, tx, topH / 2 + 7);

      // --- Hours cell ---
      const hX = cX + centerW;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(hX, 0, hoursW, topH);
      ctx.textAlign = 'center';
      const hCx = hX + hoursW / 2;
      ctx.fillStyle = accentColor;
      ctx.font = 'bold 18px Arial, Helvetica, sans-serif';
      ctx.fillText(totalHours, hCx, topH / 2 - 6);
      ctx.fillStyle = '#64748b';
      ctx.font = '600 8px Arial, Helvetica, sans-serif';
      ctx.fillText('HOURS', hCx, topH / 2 + 9);

      // --- Bottom row ---
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, topH);
      ctx.lineTo(totalW, topH);
      ctx.stroke();

      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(0, topH, totalW, botH);

      // "Powered by " + "opendronelog.com"
      const pb = 'Powered by ';
      const site = 'opendronelog.com';
      ctx.font = '400 8px Arial, Helvetica, sans-serif';
      const pbW = ctx.measureText(pb).width;
      ctx.font = '600 8px Arial, Helvetica, sans-serif';
      const sW = ctx.measureText(site).width;
      const txtStart = (totalW - pbW - sW) / 2;
      const bCy = topH + botH / 2;

      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = '400 8px Arial, Helvetica, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText(pb, txtStart, bCy);
      ctx.font = '600 8px Arial, Helvetica, sans-serif';
      ctx.fillStyle = accentColor;
      ctx.fillText(site, txtStart + pbW, bCy);

      // --- Export ---
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Blob creation failed'))), 'image/png');
      });

      const fileName = `OpenDroneLog_Signature_${totalFlights}flights.png`;

      if (isWebMode()) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        try {
          await saveBlobWithDialog(fileName, blob, [
            { name: 'PNG Image', extensions: ['png'] },
          ]);
        } catch (err) {
          console.error('Desktop save failed:', err);
        }
      }
    } catch (err) {
      console.error('Failed to export signature PNG:', err);
    } finally {
      setIsExporting(false);
    }
  }, [accentColor, totalFlights, totalHours, currentRank, logoBase64]);

  const handleCustomColorChange = (val: string) => {
    setCustomColor(val);
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      setAccentColor(val);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center p-4 overflow-y-auto bg-black/70 backdrop-blur-sm mobile-safe-container">
      <div
        className={`${isLight ? 'bg-white border-gray-200' : 'bg-drone-surface border-gray-700'} border rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl max-h-[90vh] modal-mobile-max overflow-y-auto my-auto`}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h2 className={`text-lg font-semibold ${isLight ? 'text-gray-900' : 'text-white'}`}>
            {t('signature.title')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className={`p-1 rounded ${isLight ? 'hover:bg-gray-100 text-gray-500 hover:text-gray-800' : 'hover:bg-gray-700/50 text-gray-400 hover:text-white'} transition-colors`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Color Picker */}
        <div className="mb-4">
          <label className={`block text-sm mb-2 ${isLight ? 'text-gray-600' : 'text-gray-400'}`}>
            {t('signature.accentColor')}
          </label>
          <div className="flex flex-wrap gap-2 items-center">
            {ACCENT_PRESETS.map((preset) => (
              <button
                key={preset.value}
                type="button"
                onClick={() => {
                  setAccentColor(preset.value);
                  setCustomColor(preset.value);
                }}
                className={`w-7 h-7 rounded-full border-2 transition-all ${
                  accentColor === preset.value
                    ? 'border-white scale-110 shadow-lg'
                    : isLight
                    ? 'border-gray-300 hover:border-gray-400'
                    : 'border-gray-600 hover:border-gray-400'
                }`}
                style={{ backgroundColor: preset.value }}
                title={preset.name}
              />
            ))}
            <input
              type="text"
              value={customColor}
              onChange={(e) => handleCustomColorChange(e.target.value)}
              placeholder="#06b6d4"
              className={`w-20 text-xs px-2 py-1.5 rounded-lg border ${
                isLight
                  ? 'bg-gray-50 border-gray-300 text-gray-800 placeholder-gray-400'
                  : 'bg-drone-dark border-gray-600 text-gray-100 placeholder-gray-500'
              }`}
            />
          </div>
        </div>

        {/* Signature Preview */}
        <div className={`mb-4 rounded-lg overflow-hidden border ${isLight ? 'border-gray-200' : 'border-gray-600'}`}>
          <div
            className={`p-6 flex items-center justify-center ${isLight ? 'bg-gray-50' : 'bg-gray-900/50'}`}
            style={{
              backgroundImage: `linear-gradient(45deg, ${isLight ? '#e5e7eb' : '#1e293b'} 25%, transparent 25%), linear-gradient(-45deg, ${isLight ? '#e5e7eb' : '#1e293b'} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${isLight ? '#e5e7eb' : '#1e293b'} 75%), linear-gradient(-45deg, transparent 75%, ${isLight ? '#e5e7eb' : '#1e293b'} 75%)`,
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
            }}
          >
            {/* The actual badge to capture for PNG — inline-block for tight fit */}
            <div ref={previewRef} style={{ display: 'inline-block', lineHeight: 0 }}>
              <a href="https://opendronelog.com" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit', display: 'inline-block' }}>
                <table cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse', fontFamily: 'Arial, Helvetica, sans-serif', borderRadius: 8, overflow: 'hidden' }}>
                  <tbody>
                    <tr>
                      {/* Flights stat */}
                      <td style={{ background: '#ffffff', padding: '8px 16px', verticalAlign: 'middle', textAlign: 'center' }}>
                        <div style={{ color: accentColor, fontSize: 18, fontWeight: 800, lineHeight: 1.3 }}>
                          {totalFlights}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1.2 }}>
                          {t('signature.flights')}
                        </div>
                      </td>
                      {/* Logo + Title cell */}
                      <td style={{ background: `linear-gradient(135deg, ${darkAccent}, ${accentColor})`, padding: '8px 14px', verticalAlign: 'middle' }}>
                        <table cellPadding={0} cellSpacing={0} style={{ borderCollapse: 'collapse' }}>
                          <tbody>
                            <tr>
                              <td style={{ verticalAlign: 'middle', width: 28 }}>
                                <img src={logoBase64 || logoIcon} alt="Open DroneLog" width={28} height={28} style={{ display: 'block', border: 0 }} />
                              </td>
                              <td style={{ verticalAlign: 'middle', paddingLeft: 8 }}>
                                <div style={{ color: '#ffffff', fontSize: 11, fontWeight: 700, letterSpacing: 0.5, lineHeight: 1.3 }}>
                                  {t('signature.dronePilot')}
                                </div>
                                <div style={{ color: 'rgba(255,255,255,0.75)', fontSize: 9, fontWeight: 500, letterSpacing: 0.3, lineHeight: 1.3 }}>
                                  {currentRank}
                                </div>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </td>
                      {/* Hours stat */}
                      <td style={{ background: '#ffffff', padding: '8px 16px', verticalAlign: 'middle', textAlign: 'center' }}>
                        <div style={{ color: accentColor, fontSize: 18, fontWeight: 800, lineHeight: 1.3 }}>
                          {totalHours}
                        </div>
                        <div style={{ color: '#64748b', fontSize: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.8, lineHeight: 1.2 }}>
                          {t('signature.hours')}
                        </div>
                      </td>
                    </tr>
                    {/* Powered by row */}
                    <tr>
                      <td colSpan={3} style={{ background: '#f8fafc', padding: '5px 12px 7px', textAlign: 'center', borderTop: '1px solid #e2e8f0' }}>
                        <span style={{ color: '#94a3b8', fontSize: 8, letterSpacing: 0.3 }}>
                          {t('signature.poweredBy')}{' '}
                        </span>
                        <span style={{ color: accentColor, fontSize: 8, fontWeight: 600, letterSpacing: 0.3 }}>
                          opendronelog.com
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </a>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 justify-end flex-wrap">
          <button
            type="button"
            onClick={onClose}
            className={`px-4 py-2 text-sm rounded-lg transition-colors ${
              isLight
                ? 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                : 'text-gray-300 hover:text-white hover:bg-gray-700/50'
            }`}
          >
            {t('signature.cancel')}
          </button>
          <button
            type="button"
            onClick={handleCopyHtml}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 border ${
              isLight
                ? 'border-gray-300 text-gray-700 hover:bg-gray-100'
                : 'border-gray-600 text-gray-200 hover:bg-gray-700/50'
            }`}
          >
            {copied ? (
              <>
                <svg className="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {t('signature.copied')}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                {t('signature.copyHtml')}
              </>
            )}
          </button>
          <button
            type="button"
            onClick={handleDownloadPng}
            disabled={isExporting}
            className="px-4 py-2 text-sm font-medium text-white bg-drone-primary hover:bg-drone-primary/80 rounded-lg transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            {isExporting ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
                  <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" className="opacity-75" />
                </svg>
                {t('signature.saving')}
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                {t('signature.downloadPng')}
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
