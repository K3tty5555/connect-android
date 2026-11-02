// First: catch fatal JavaScript errors before anything else can throw (ADR-008).
import './src/crash/installCrashCapture';
import { registerRootComponent } from 'expo';

import App from './App';
import { withCrashBoundary } from './src/crash/withCrashBoundary';

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
// The boundary records render errors, which never reach ErrorUtils (ADR-008).
registerRootComponent(withCrashBoundary(App));
