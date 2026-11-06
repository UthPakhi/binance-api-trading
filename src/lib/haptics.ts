// Native Web Haptics API utility for mobile browsers
// Provides subtle tactile feedback on tap targets, gesture expansions, and quick actions
// while respecting prefers-reduced-motion and failing silently on unsupported devices.

export type HapticPattern = 'selection' | 'light' | 'medium' | 'heavy' | 'success' | 'warning';

const HAPTIC_PATTERNS: Record<HapticPattern, number | number[]> = {
  selection: 8,
  light: 12,
  medium: 18,
  heavy: 28,
  success: [10, 35, 16],
  warning: [18, 30, 22],
};

let lastHapticTime = 0;

export function triggerHaptic(pattern: HapticPattern = 'selection'): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return;

  try {
    // Respect user accessibility preference for reduced motion
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    // Throttle rapid fire haptics (minimum 25ms apart)
    const now = Date.now();
    if (now - lastHapticTime < 25) return;
    lastHapticTime = now;

    if (typeof navigator.vibrate === 'function') {
      navigator.vibrate(HAPTIC_PATTERNS[pattern] ?? 10);
    }
  } catch {
    // Ignore errors on browsers/WebViews that block or do not implement navigator.vibrate
  }
}
