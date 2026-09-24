import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { colors } from '../theme';

type Name = ComponentProps<typeof MaterialCommunityIcons>['name'];

/** Line icon in the app's text colour. */
export default function Icon({ name, size = 24, color = colors.text }: { name: Name; size?: number; color?: string }) {
  return <MaterialCommunityIcons name={name} size={size} color={color} />;
}
