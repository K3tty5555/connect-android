import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';
import {
  mobileRouteKey,
  type MobileRoute,
  type MobileRouteTransition,
} from '../navigation/routes';
import {
  createMobileRouteStack,
  mobileRouteLayerMotion,
  mobileRouteLayerRole,
  presentMobileRoute,
  settleMobileRouteStack,
} from '../navigation/routeStack';
import { MobileRouteActivityProvider } from '../navigation/routeActivity';
import { useReducedMotion } from '../theme/reducedMotion';
import { MOTION } from '../theme/tokens';

export function RouteTransitionView({
  children,
  contentReady = true,
  operationId,
  onFirstPaint,
  onStableFrame,
  route,
  transition,
}: {
  children: ReactNode;
  contentReady?: boolean;
  operationId?: string | null;
  onFirstPaint?: (operationId: string) => void;
  onStableFrame?: (operationId: string) => void;
  route: MobileRoute;
  transition: MobileRouteTransition;
}): React.ReactElement {
  const reducedMotion = useReducedMotion();
  const routeKey = mobileRouteKey(route);
  const [stack, setStack] = useState(() => createMobileRouteStack(route, reducedMotion));
  const progress = useRef(new Animated.Value(1)).current;
  const cachedNodes = useRef(new Map<string, ReactNode>());
  const latestCommittedNode = useRef({ key: routeKey, node: children });
  const onFirstPaintRef = useRef(onFirstPaint);
  const onStableFrameRef = useRef(onStableFrame);
  onFirstPaintRef.current = onFirstPaint;
  onStableFrameRef.current = onStableFrame;

  if (stack.currentKey !== routeKey || stack.reducedMotion !== reducedMotion) {
    cachedNodes.current.set(
      latestCommittedNode.current.key,
      latestCommittedNode.current.node,
    );
    setStack(presentMobileRoute(stack, route, transition, reducedMotion));
  }

  useLayoutEffect(() => {
    if (!contentReady) return;
    latestCommittedNode.current = { key: routeKey, node: children };
  }, [children, contentReady, routeKey]);

  useEffect(() => {
    const retained = new Set(stack.layers.map((layer) => layer.key));
    for (const key of cachedNodes.current.keys()) {
      if (!retained.has(key)) cachedNodes.current.delete(key);
    }
  }, [stack.layers]);

  useLayoutEffect(() => {
    let active = true;
    let firstPaintFrame: number | null = null;
    let stableFrame: number | null = null;
    const markStableFrame = (): void => {
      if (operationId === null || operationId === undefined) return;
      stableFrame = requestAnimationFrame(() => {
        if (active) onStableFrameRef.current?.(operationId);
      });
    };
    if (operationId !== null && operationId !== undefined) {
      firstPaintFrame = requestAnimationFrame(() => {
        if (active) onFirstPaintRef.current?.(operationId);
      });
    }
    if (stack.sourceKey === null) {
      progress.setValue(1);
      markStableFrame();
      return () => {
        active = false;
        if (firstPaintFrame !== null) cancelAnimationFrame(firstPaintFrame);
        if (stableFrame !== null) cancelAnimationFrame(stableFrame);
      };
    }
    progress.setValue(0);
    const generation = stack.generation;
    const animation = Animated.timing(progress, {
      duration: MOTION.fast02,
      easing: Easing.bezier(0.2, 0, 0.38, 0.9),
      toValue: 1,
      useNativeDriver: true,
    });
    animation.start(({ finished }) => {
      if (!finished || !active) return;
      setStack((current) => settleMobileRouteStack(current, generation));
      markStableFrame();
    });
    return () => {
      active = false;
      animation.stop();
      if (firstPaintFrame !== null) cancelAnimationFrame(firstPaintFrame);
      if (stableFrame !== null) cancelAnimationFrame(stableFrame);
    };
  }, [operationId, progress, stack.generation]);

  return (
    <Animated.View style={styles.root}>
      {stack.layers.map((layer) => {
        const role = mobileRouteLayerRole(stack, layer.key);
        const current = layer.key === stack.currentKey;
        const visible = role !== 'inactive';
        const motion = mobileRouteLayerMotion(role, stack.transition);
        const opacity = role === 'active' || role === 'inactive'
          ? motion.opacityTo
          : progress.interpolate({
              inputRange: [0, 1],
              outputRange: [motion.opacityFrom, motion.opacityTo],
            });
        const translateX = role === 'active' || role === 'inactive'
          ? motion.translateXTo
          : progress.interpolate({
              inputRange: [0, 1],
              outputRange: [motion.translateXFrom, motion.translateXTo],
            });
        const retainedCurrentNode = latestCommittedNode.current.key === layer.key
          ? latestCommittedNode.current.node
          : cachedNodes.current.get(layer.key) ?? null;
        return (
          <Animated.View
            accessibilityElementsHidden={!current}
            importantForAccessibility={current ? 'auto' : 'no-hide-descendants'}
            key={layer.key}
            pointerEvents={current ? 'auto' : 'none'}
            testID={`route-layer-${role}`}
            style={[
              styles.layer,
              !visible ? styles.hidden : null,
              { opacity, transform: [{ translateX }], zIndex: motion.zIndex },
            ]}
          >
            <MobileRouteActivityProvider active={current}>
              {current
                ? contentReady ? children : retainedCurrentNode
                : cachedNodes.current.get(layer.key) ?? null}
            </MobileRouteActivityProvider>
          </Animated.View>
        );
      })}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, overflow: 'hidden', position: 'relative' },
  layer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  hidden: { display: 'none' },
});
