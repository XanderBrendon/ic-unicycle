import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Top-level error boundary so a single render-time exception surfaces a
 * readable message instead of unmounting the whole tree to a blank page.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled render error:', error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div style={{ padding: '1rem', maxWidth: '40rem' }}>
        <h2>Something went wrong</h2>
        <p style={{ color: 'crimson' }}>{error.message}</p>
        <button onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
