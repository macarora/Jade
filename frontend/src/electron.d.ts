interface Window {
  electron?: {
    updateTitlebarTheme: (theme: 'light' | 'dark' | 'system') => void;
    changeSourcesDir:    () => Promise<string | null>;
  };
}
