import { useCallback, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Platform,
  StyleSheet,
  View,
  type GestureResponderEvent,
  type PanResponderGestureState,
} from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { haptics } from '@/lib/haptics';
import { dotBetween, GRID } from '@/lib/patternLock';
import { usePrefs } from '@/providers/PreferencesProvider';
import { useTheme } from '@/theme/useTheme';

export type PadState = 'idle' | 'error' | 'success';

interface Props {
  /** Fired on release with the dots touched, in order. */
  onComplete: (dots: number[]) => void;
  /** Fired as a new drawing begins, so the caller can clear a failure. */
  onStart?: () => void;
  state: PadState;
  disabled?: boolean;
  /** Side of the square grid in points. */
  size?: number;
}

interface Point {
  x: number;
  y: number;
}

const TRAIL = 4;
const DOT = 16;
const RING = 44;

/**
 * The 3×3 unlock grid.
 *
 * Drawn with plain views rather than SVG — the project has no SVG dependency,
 * and a line is a thin rectangle rotated about its own centre, which behaves
 * identically on web and device.
 *
 * Every child is `pointerEvents="none"` so the grid itself always stays the
 * touch target. Without that, dragging over a dot retargets the event and the
 * coordinates start arriving relative to the dot instead of the grid, which
 * makes the trail jump.
 */
export function PatternPad({ onComplete, onStart, state, disabled, size = 264 }: Props) {
  const theme = useTheme();
  const { accentColors } = usePrefs();

  const [dots, setDots] = useState<number[]>([]);
  const [pointer, setPointer] = useState<Point | null>(null);

  // The responder is built once and would otherwise hold the first render's
  // props and state forever: the dots it appends to, and the callbacks it
  // fires. Both are reached through refs so it always sees the current ones.
  const dotsRef = useRef<number[]>([]);
  const handlers = useRef({ onComplete, onStart });
  handlers.current = { onComplete, onStart };

  /**
   * Where the grid sits in the window, so a touch reported in window
   * coordinates can be turned into one inside the grid.
   *
   * The pad used to read `locationX`/`locationY`, and those are not one
   * measurement: they are relative to whichever view the platform decides the
   * touch belongs to, and iOS and Android do not decide it the same way or at
   * the same moment during a drag. Anything but the grid as that reference puts
   * the coordinates in the wrong frame, and dots stop being recognised —
   * which is what a pattern that cannot be drawn on a phone looks like.
   * `pageX`/`pageY` are the window, always, and the window does not move under
   * the finger.
   *
   * Web keeps the old path: there `measureInWindow` is viewport-relative while
   * `pageX` includes the document scroll, so mixing them would introduce on the
   * one build that is known to work the exact bug being removed here.
   */
  const grid = useRef<View>(null);
  const origin = useRef<Point>({ x: 0, y: 0 });
  const windowCoords = Platform.OS !== 'web';

  const remeasure = useCallback(() => {
    grid.current?.measureInWindow((x, y) => {
      if (Number.isFinite(x) && Number.isFinite(y)) origin.current = { x, y };
    });
  }, []);

  const cell = size / GRID;
  const centres = useMemo<Point[]>(
    () =>
      Array.from({ length: GRID * GRID }, (_, i) => ({
        x: (i % GRID) * cell + cell / 2,
        y: Math.floor(i / GRID) * cell + cell / 2,
      })),
    [cell]
  );

  const colour =
    state === 'error' ? theme.danger : state === 'success' ? theme.success : accentColors.base;

  const responder = useMemo(() => {
    const at = (x: number, y: number): number => {
      // Generous but not overlapping: a third of a cell keeps neighbouring dots
      // from both answering to the same position.
      const reach = cell * 0.34;
      return centres.findIndex((c) => Math.hypot(c.x - x, c.y - y) <= reach);
    };

    const track = (x: number, y: number) => {
      setPointer({ x, y });

      const hit = at(x, y);
      if (hit < 0) return;

      const current = dotsRef.current;
      if (current.includes(hit)) return;

      const next = [...current];
      const previous = current[current.length - 1];
      if (previous !== undefined) {
        // Passing straight over an untouched dot picks it up, the way a phone's
        // own lock screen does.
        const skipped = dotBetween(previous, hit);
        if (skipped !== null && !next.includes(skipped)) next.push(skipped);
      }
      next.push(hit);

      dotsRef.current = next;
      setDots(next);
      haptics.select();
    };

    const finish = () => {
      setPointer(null);
      const drawn = dotsRef.current;
      dotsRef.current = [];
      if (drawn.length > 0) handlers.current.onComplete(drawn);
    };

    /** The touch, in the grid's own coordinates, whatever the platform reports. */
    const local = (
      event: GestureResponderEvent,
      gesture: PanResponderGestureState,
      start: boolean
    ): Point => {
      if (!windowCoords) {
        return { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
      }
      // `pageX` is absent on a synthesised event; the gesture state carries the
      // same window coordinate and is always populated.
      const pageX = event.nativeEvent.pageX ?? (start ? gesture.x0 : gesture.moveX);
      const pageY = event.nativeEvent.pageY ?? (start ? gesture.y0 : gesture.moveY);
      return { x: pageX - origin.current.x, y: pageY - origin.current.y };
    };

    return PanResponder.create({
      onStartShouldSetPanResponder: () => !disabled,
      onMoveShouldSetPanResponder: () => !disabled,
      // Capture as well: a parent that also wants the drag — a scroll view, or
      // the navigator's own swipe — must not get to take it first.
      onStartShouldSetPanResponderCapture: () => !disabled,
      onMoveShouldSetPanResponderCapture: () => !disabled,

      onPanResponderGrant: (event, gesture) => {
        dotsRef.current = [];
        setDots([]);
        handlers.current.onStart?.();
        // The pad is static on both lock screens, but a re-measure here costs
        // nothing and keeps the first dot honest if it ever is not.
        remeasure();
        const point = local(event, gesture, true);
        track(point.x, point.y);
      },

      onPanResponderMove: (event, gesture) => {
        const point = local(event, gesture, false);
        track(point.x, point.y);
      },

      // Half a drawn pattern handed to the matcher is a failed attempt, and
      // five of those sign the owner out. Nothing else may claim this gesture.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,

      onPanResponderRelease: finish,
      onPanResponderTerminate: finish,
    });
  }, [disabled, cell, centres, windowCoords, remeasure]);

  // The rubber band from the last dot to the finger, only while still drawing.
  const lastDot = dots.length > 0 ? dots[dots.length - 1] : undefined;
  const lastCentre = lastDot === undefined ? undefined : centres[lastDot];
  const trailing = pointer && lastCentre ? { from: lastCentre, to: pointer } : null;

  return (
    <View
      ref={grid}
      onLayout={remeasure}
      {...responder.panHandlers}
      style={[styles.grid, { width: size, height: size }]}
    >
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        {dots.map((dot, i) => {
          if (i === 0) return null;
          const from = centres[dots[i - 1]!];
          const to = centres[dot];
          if (!from || !to) return null;
          return <Segment key={`${dots[i - 1]}-${dot}`} from={from} to={to} colour={colour} />;
        })}

        {trailing ? <Segment from={trailing.from} to={trailing.to} colour={colour} faint /> : null}

        {centres.map((centre, i) => {
          const on = dots.includes(i);
          return (
            <View
              key={i}
              style={[styles.slot, { left: centre.x - RING / 2, top: centre.y - RING / 2 }]}
            >
              {on ? (
                <Animated.View
                  entering={FadeIn.duration(120)}
                  style={[styles.ring, { borderColor: colour }]}
                />
              ) : null}
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: on ? colour : theme.textFaint,
                    transform: [{ scale: on ? 1 : 0.62 }],
                  },
                ]}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** One straight run of the trail: a thin bar rotated about its own centre. */
function Segment({
  from,
  to,
  colour,
  faint,
}: {
  from: Point;
  to: Point;
  colour: string;
  faint?: boolean;
}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1) return null;

  return (
    <View
      style={[
        styles.segment,
        {
          left: (from.x + to.x) / 2 - length / 2,
          top: (from.y + to.y) / 2 - TRAIL / 2,
          width: length,
          backgroundColor: colour,
          opacity: faint ? 0.45 : 0.9,
          transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  grid: { alignSelf: 'center' },
  segment: { position: 'absolute', height: TRAIL, borderRadius: TRAIL / 2 },
  slot: {
    position: 'absolute',
    width: RING,
    height: RING,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: RING,
    height: RING,
    borderRadius: RING / 2,
    borderWidth: 2,
    opacity: 0.5,
  },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2 },
});
