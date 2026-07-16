// Claude palette — mirrors the web GUI and the Wear OS client exactly.
export class C {
  static readonly clay: string = '#D97757';
  static readonly clayDeep: string = '#C15F3C';
  static readonly clayTint: string = '#2ED97757'; // clay @ ~18% alpha
  static readonly onClay: string = '#2A1A12';
  static readonly bg: string = '#262624';
  static readonly surface: string = '#1F1E1D';
  static readonly surface2: string = '#34322F';
  static readonly ink: string = '#F7F6F1';
  static readonly muted: string = '#B1ADA1';
  static readonly faint: string = '#86837C';
  static readonly border: string = '#3A3936';
  static readonly ok: string = '#7BBD8A';
  static readonly err: string = '#E0806A';

  // Bubble accents
  static readonly filteredBg: string = '#3A201C';
  static readonly filteredFg: string = '#F0B3A6';
  static readonly scrim: string = 'rgba(15,14,13,0.86)';
  static readonly confirmTitle: string = '#E0B072';
  static readonly confirmBg: string = '#191512';
  static readonly confirmFg: string = '#F0E5D5';
}

// Titles / wordmark use a serif face to match the other clients.
// HarmonyOS ships 'HarmonyOS Sans'; 'serif' resolves to the system serif fallback.
export const SERIF: string = 'serif';

// The Claude 4-point spark as SVG path commands, scaled to `size` px.
export function sparkPath(size: number): string {
  const k: number = size / 108.0;
  const v = (x: number): string => (x * k).toFixed(2);
  return 'M' + v(54) + ' ' + v(30) +
    ' C ' + v(56) + ' ' + v(48) + ' ' + v(60) + ' ' + v(52) + ' ' + v(78) + ' ' + v(54) +
    ' C ' + v(60) + ' ' + v(56) + ' ' + v(56) + ' ' + v(60) + ' ' + v(54) + ' ' + v(78) +
    ' C ' + v(52) + ' ' + v(60) + ' ' + v(48) + ' ' + v(56) + ' ' + v(30) + ' ' + v(54) +
    ' C ' + v(48) + ' ' + v(52) + ' ' + v(52) + ' ' + v(48) + ' ' + v(54) + ' ' + v(30) +
    ' Z';
}
