import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { colors } from '../theme';

/** Slide-in drawer from the left with a dimmed backdrop; stays mounted so its state survives closing. */
export default function Sidebar({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.84, 360);
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: open ? 1 : 0, duration: 220, useNativeDriver: true }).start();
  }, [open, progress]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? 'auto' : 'none'}>
      <Animated.View style={[styles.scrim, { opacity: progress }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      </Animated.View>
      <Animated.View
        style={[
          styles.drawer,
          { width: drawerWidth, transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-drawerWidth, 0] }) }] },
        ]}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(8,10,15,0.6)' },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.bg },
});
