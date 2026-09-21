import { useEffect, useRef } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { colors } from '../theme';

/** Slide-in drawer from the left with a dimmed backdrop (swipe left to close); stays mounted so its state survives closing. */
export default function Sidebar({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  const { width } = useWindowDimensions();
  const drawerWidth = Math.min(width * 0.84, 360);
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, { toValue: open ? 1 : 0, duration: 220, useNativeDriver: true }).start();
  }, [open, progress]);

  // A quick swipe to the left closes the drawer; only mostly-horizontal drags count, so the list still scrolls.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const swipe = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => g.dx < -12 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderRelease: (_, g) => g.dx < -60 && onCloseRef.current(),
    }),
  ).current;

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
        <View style={{ flex: 1 }} {...swipe.panHandlers}>
          {children}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(8,10,15,0.6)' },
  drawer: { position: 'absolute', top: 0, bottom: 0, left: 0, backgroundColor: colors.bg },
});
