import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './App';
import { ErrorBoundary } from './ErrorBoundary';
import { ThemeProvider } from './ui/theme';
import { ToastProvider } from './ui/toast';

const container = document.getElementById('root');
if (!container) throw new Error('root element missing');
createRoot(container).render(
  <ErrorBoundary>
    <ThemeProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </ThemeProvider>
  </ErrorBoundary>,
);
