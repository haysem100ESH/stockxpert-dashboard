import { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface AdvancedModeContextType {
  isAdvancedMode: boolean;
  toggleAdvancedMode: () => void;
}

const AdvancedModeContext = createContext<AdvancedModeContextType>({
  isAdvancedMode: false,
  toggleAdvancedMode: () => {},
});

export function AdvancedModeProvider({ children }: { children: ReactNode }) {
  const [isAdvancedMode, setIsAdvancedMode] = useState(() => {
    const stored = localStorage.getItem('advancedMode');
    return stored === 'true';
  });

  useEffect(() => {
    localStorage.setItem('advancedMode', String(isAdvancedMode));
  }, [isAdvancedMode]);

  const toggleAdvancedMode = () => setIsAdvancedMode(prev => !prev);

  return (
    <AdvancedModeContext.Provider value={{ isAdvancedMode, toggleAdvancedMode }}>
      {children}
    </AdvancedModeContext.Provider>
  );
}

export const useAdvancedMode = () => useContext(AdvancedModeContext);
