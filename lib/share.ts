import * as Clipboard from 'expo-clipboard';
import { Share } from 'react-native';

export type ShareOutcome = 'shared' | 'copied' | 'failed';

/**
 * Hands `text` to the OS share sheet, falling back to the clipboard.
 *
 * `Share.share` is not universally available: react-native-web rejects outright
 * unless the browser implements `navigator.share`, which desktop browsers
 * largely do not. The original call site ignored that rejection, so pressing
 * "send invite link" on a laptop did nothing at all, silently.
 *
 * Returns how the text actually left the app so the caller can say so.
 */
export async function shareOrCopy(text: string): Promise<ShareOutcome> {
  try {
    // A dismissed sheet still counts: the user saw it and chose to back out.
    await Share.share({ message: text });
    return 'shared';
  } catch {
    // Falls through to the clipboard.
  }

  try {
    await Clipboard.setStringAsync(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
