import {
  mobileRouteKey,
  type MobileRoute,
  type MobileRouteTransition,
} from './routes';

export interface MobileRouteStackLayer {
  key: string;
  route: MobileRoute;
}

export interface MobileRouteStack {
  currentKey: string;
  generation: number;
  layers: MobileRouteStackLayer[];
  reducedMotion: boolean;
  settledKeys: string[];
  sourceKey: string | null;
  transition: MobileRouteTransition;
}

export type MobileRouteLayerRole = 'active' | 'inactive' | 'incoming' | 'outgoing';

export interface MobileRouteLayerMotion {
  opacityFrom: number;
  opacityTo: number;
  translateXFrom: number;
  translateXTo: number;
  zIndex: number;
}

export function createMobileRouteStack(
  route: MobileRoute,
  reducedMotion = false,
): MobileRouteStack {
  const layer = routeLayer(route);
  return {
    currentKey: layer.key,
    generation: 0,
    layers: [layer],
    reducedMotion,
    settledKeys: [layer.key],
    sourceKey: null,
    transition: 'none',
  };
}

export function presentMobileRoute(
  stack: MobileRouteStack,
  route: MobileRoute,
  transition: MobileRouteTransition,
  reducedMotion: boolean,
): MobileRouteStack {
  const target = routeLayer(route);
  if (target.key === stack.currentKey) {
    if (reducedMotion === stack.reducedMotion) return stack;
    return {
      ...stack,
      generation: stack.generation + 1,
      layers: stack.layers.filter((layer) => stack.settledKeys.includes(layer.key)),
      reducedMotion,
      sourceKey: null,
      transition: 'none',
    };
  }

  if (reducedMotion || transition === 'none') {
    return {
      currentKey: target.key,
      generation: stack.generation + 1,
      layers: [target],
      reducedMotion,
      settledKeys: [target.key],
      sourceKey: null,
      transition: 'none',
    };
  }

  const retained = retainedLayers(stack.layers, route);
  const settled = upsertLayer(retained, target);
  const source = stack.layers.find((layer) => layer.key === stack.currentKey);
  const layers = source && !settled.some((layer) => layer.key === source.key)
    ? [...settled, source]
    : settled;
  return {
    currentKey: target.key,
    generation: stack.generation + 1,
    layers,
    reducedMotion,
    settledKeys: settled.map((layer) => layer.key),
    sourceKey: stack.currentKey,
    transition,
  };
}

export function settleMobileRouteStack(
  stack: MobileRouteStack,
  generation: number,
): MobileRouteStack {
  if (stack.generation !== generation || stack.sourceKey === null) return stack;
  return {
    ...stack,
    layers: stack.layers.filter((layer) => stack.settledKeys.includes(layer.key)),
    sourceKey: null,
  };
}

export function mobileRouteLayerRole(
  stack: MobileRouteStack,
  key: string,
): MobileRouteLayerRole {
  if (key === stack.currentKey) return stack.sourceKey === null ? 'active' : 'incoming';
  if (key === stack.sourceKey) return 'outgoing';
  return 'inactive';
}

export function mobileRouteLayerMotion(
  role: MobileRouteLayerRole,
  transition: MobileRouteTransition,
): MobileRouteLayerMotion {
  if (role === 'incoming') {
    if (transition === 'forward') return motion(1, 1, 6, 0, 2);
    if (transition === 'back') return motion(1, 1, -6, 0, 1);
    if (transition === 'tab') return motion(0, 1, 0, 0, 2);
  }
  if (role === 'outgoing') {
    if (transition === 'forward') return motion(1, 1, 0, -6, 1);
    if (transition === 'back') return motion(1, 1, 0, 6, 2);
    if (transition === 'tab') return motion(1, 0, 0, 0, 1);
  }
  return motion(role === 'inactive' ? 0 : 1, role === 'inactive' ? 0 : 1, 0, 0, 0);
}

function routeLayer(route: MobileRoute): MobileRouteStackLayer {
  return { key: mobileRouteKey(route), route };
}

function retainedLayers(
  layers: readonly MobileRouteStackLayer[],
  target: MobileRoute,
): MobileRouteStackLayer[] {
  return layers.filter((layer) => {
    if (layer.route.kind === 'root') return true;
    if (target.kind === 'root') return false;
    if (layer.route.kind === 'project') {
      return layer.route.workspaceCapability === target.workspaceCapability;
    }
    return target.kind === 'session' && layer.key === mobileRouteKey(target);
  });
}

function upsertLayer(
  layers: readonly MobileRouteStackLayer[],
  target: MobileRouteStackLayer,
): MobileRouteStackLayer[] {
  const existing = layers.findIndex((layer) => layer.key === target.key);
  if (existing < 0) return [...layers, target];
  return layers.map((layer, index) => index === existing ? target : layer);
}

function motion(
  opacityFrom: number,
  opacityTo: number,
  translateXFrom: number,
  translateXTo: number,
  zIndex: number,
): MobileRouteLayerMotion {
  return { opacityFrom, opacityTo, translateXFrom, translateXTo, zIndex };
}
