import type { ComponentType } from 'react';
import { CrashBoundary } from './CrashBoundary';
import { mobileCrashContext } from './crashContext';

type ExpoCrashLog = typeof import('./expoCrashLog');

/** Wraps the root component (index.ts); the file store is loaded only when a render error happens. */
export function withCrashBoundary(Root: ComponentType): ComponentType {
  const context = mobileCrashContext();
  const record: CrashBoundary['props']['record'] = (entry) => {
    (require('./expoCrashLog') as ExpoCrashLog).mobileCrashLogStore().record(entry);
  };
  function CrashBoundaryRoot(): React.ReactElement {
    return (
      <CrashBoundary record={record} context={context}>
        <Root />
      </CrashBoundary>
    );
  }
  return CrashBoundaryRoot;
}
