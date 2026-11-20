// Component-level error boundary (40 section 7.8). Wraps each ApprovalCard, the Playground device and each Settings
// card. Errors go to console.error only; no crash reporting.
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ERROR_BOUNDARY_COPY } from '@/copy/screens-main';
import { Button } from '../Button/Button';
import styles from './ErrorBoundary.module.css';

export interface ErrorBoundaryProps {
  children: ReactNode;
  /** Called when "Try again" resets the boundary. */
  onReset?(): void;
}

interface State {
  failed: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  private reset = () => {
    this.props.onReset?.();
    this.setState({ failed: false });
  };

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className={styles.fallback}>
        <h2 className={styles.title}>{ERROR_BOUNDARY_COPY.title}</h2>
        <p className={styles.body}>{ERROR_BOUNDARY_COPY.body}</p>
        <div>
          <Button variant="secondary" onClick={this.reset}>
            {ERROR_BOUNDARY_COPY.retry}
          </Button>
        </div>
      </div>
    );
  }
}
