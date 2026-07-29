import * as Haptics from 'expo-haptics';

/**
 * Fire-and-forget. Haptics reject on simulators and unsupported hardware, and
 * a missing buzz must never surface as an error to the user.
 */
const fire = (run: () => Promise<void>) => {
  void run().catch(() => undefined);
};

export const haptics = {
  /** Every button press. */
  tap: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Destructive or high-stakes press, e.g. WARN. */
  heavy: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  /** Moving between segments, pickers, chips. */
  select: () => fire(() => Haptics.selectionAsync()),
  saved: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warn: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  failed: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
