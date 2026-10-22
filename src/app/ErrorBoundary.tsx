import { Component, type ReactNode } from 'react';

/** Shows a readable message instead of a blank page if rendering throws. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 32, maxWidth: 640, margin: '10vh auto', fontFamily: 'system-ui', color: '#ece2cc' }}>
        <h1 style={{ fontFamily: 'Georgia, serif', color: '#d9b465' }}>The studio hit an error</h1>
        <p>{this.state.error.message}</p>
        <button
          onClick={() => {
            try {
              localStorage.removeItem('fox-files-studio:mkultra-project');
            } catch {
              /* ignore */
            }
            location.reload();
          }}
        >
          Reset the saved project and reload
        </button>
      </div>
    );
  }
}
