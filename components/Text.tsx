import { Text as RNText, type TextProps } from 'react-native';
import { usePrefs } from '@/providers/PreferencesProvider';
import { typeStyle, type TypeVariant } from '@/theme/tokens';
import { useTheme } from '@/theme/useTheme';

interface Props extends TextProps {
  variant?: TypeVariant;
  color?: string;
  center?: boolean;
  /** Tabular figures so columns of money stay aligned. */
  numeric?: boolean;
}

export function Text({
  variant = 'body',
  color,
  center,
  numeric,
  style,
  ...rest
}: Props) {
  const { textScale } = usePrefs();
  const theme = useTheme();
  return (
    <RNText
      {...rest}
      style={[
        typeStyle(variant, textScale),
        { color: color ?? theme.text },
        center && { textAlign: 'center' },
        numeric && { fontVariant: ['tabular-nums'] },
        style,
      ]}
    />
  );
}
