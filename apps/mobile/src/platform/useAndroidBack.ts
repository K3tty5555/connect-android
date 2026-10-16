import { useEffect } from 'react';
import { BackHandler, Platform } from 'react-native';
import { KeyboardController } from 'react-native-keyboard-controller';
import { useMobileRouteActive } from '../navigation/routeActivity';

export function useAndroidBack(draft: string, onBack?: () => boolean): void {
  const routeActive = useMobileRouteActive();
  useEffect(() => {
    if (Platform.OS !== 'android' || !routeActive) return;

    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        if (KeyboardController.isVisible()) {
          void KeyboardController.dismiss();
          return true;
        }
        if (draft.length > 0) return true;
        return onBack?.() ?? false;
      },
    );

    return () => subscription.remove();
  }, [draft, onBack, routeActive]);
}
