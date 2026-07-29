import { Text as RNText, type TextProps } from 'react-native';
import { usePrefs } from '@/providers/PreferencesProvider';
import { palette, typeStyle, type TypeVariant } from '@/theme/tokens';

interface Props extends TextProps {
  variant?: TypeVariant;
  color?: string;
  center?: boolean;
  /** Tabular figures so columns of money stay aligned. */
  numeric?: boolean;
}

export function Text({
  variant = 'body',
  color = palette.text,
  center,
  numeric,
  style,
  ...rest
}: Props) {
  const { textScale } = usePrefs();
  return (
    <RNText
      {...rest}
      style={[
        typeStyle(variant, textScale),
        { color },
        center && { textAlign: 'center' },
        numeric && { fontVariant: ['tabular-nums'] },
        style,
      ]}
    />
  );
}
