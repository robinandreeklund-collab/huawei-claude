import { vibrator } from '@kit.SensorServiceKit';

// Haptic patterns matching the Wear client's buzzes. Failures are swallowed —
// haptics are never load-bearing.
export class Haptics {
  private static fire(duration: number): void {
    try {
      vibrator.startVibration(
        { type: 'time', duration: duration } as vibrator.VibrateTime,
        { id: 0, usage: 'notification' } as vibrator.VibrateAttribute,
        (err) => {
          // ignore — best effort
        }
      );
    } catch (e) {
      // vibrator unavailable
    }
  }

  /** Light tick — sensor replies, chip taps. */
  static tap(): void {
    Haptics.fire(24);
  }

  /** Double buzz — turn done, notifications, confirmations. */
  static double(): void {
    Haptics.fire(18);
    setTimeout(() => Haptics.fire(24), 70);
  }

  /** Long buzz — the "long" vibrate action. */
  static long(): void {
    Haptics.fire(320);
  }

  /** Map a watch_action vibrate pattern name to a buzz. */
  static pattern(name: string): void {
    if (name === 'double') {
      Haptics.double();
    } else if (name === 'long') {
      Haptics.long();
    } else {
      Haptics.tap();
    }
  }
}
