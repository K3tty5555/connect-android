import { createContext, useContext, type ReactNode } from 'react';

const MobileRouteActivityContext = createContext(true);

export function MobileRouteActivityProvider({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}): React.ReactElement {
  return (
    <MobileRouteActivityContext.Provider value={active}>
      {children}
    </MobileRouteActivityContext.Provider>
  );
}

export function useMobileRouteActive(): boolean {
  return useContext(MobileRouteActivityContext);
}
