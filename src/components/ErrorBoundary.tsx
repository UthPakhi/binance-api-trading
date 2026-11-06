import React, { ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from './Button';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
    };
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[50vh] flex flex-col items-center justify-center p-6 text-center">
          <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center mb-4 text-rose-400">
            <AlertTriangle className="w-7 h-7" />
          </div>
          <h2 className="text-lg font-bold text-neutral-100 mb-1">
            {this.props.fallbackTitle || 'Something went wrong'}
          </h2>
          <p className="text-xs text-neutral-400 max-w-sm mb-5 font-mono break-all">
            {this.state.error?.message || 'An unexpected rendering error occurred.'}
          </p>
          <Button
            onClick={this.handleReset}
            className="flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700 text-xs px-4 py-2"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Reload App
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
