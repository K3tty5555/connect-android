import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

export type InteractionFeedbackAction = 'selection' | 'surface_create' | 'takeover';
export type InteractionFeedbackPhase = 'pending' | 'completed' | 'failed';
export type InteractionFeedbackOrigin = 'user' | 'automatic' | 'background';
export type InteractionFeedbackKind = 'selection' | 'light_impact';

export interface InteractionFeedbackEvent {
  action: InteractionFeedbackAction;
  origin: InteractionFeedbackOrigin;
  phase: InteractionFeedbackPhase;
}

export interface InteractionFeedbackDriver {
  selection(): Promise<void>;
  lightImpact(): Promise<void>;
}

const expoDriver: InteractionFeedbackDriver = {
  selection: () => Haptics.selectionAsync(),
  lightImpact: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
};

export function interactionFeedbackKind(
  event: InteractionFeedbackEvent,
): InteractionFeedbackKind | null {
  if (event.origin !== 'user' || event.phase !== 'completed') return null;
  return event.action === 'selection' ? 'selection' : 'light_impact';
}

/** Haptics are optional acknowledgement and never participate in operation settlement. */
export async function playInteractionFeedback(
  event: InteractionFeedbackEvent,
  platform = Platform.OS,
  driver: InteractionFeedbackDriver = expoDriver,
): Promise<void> {
  if (platform !== 'ios') return;
  const kind = interactionFeedbackKind(event);
  if (kind === null) return;
  try {
    if (kind === 'selection') await driver.selection();
    else await driver.lightImpact();
  } catch {
    // Devices without an available haptic engine keep the business interaction intact.
  }
}
