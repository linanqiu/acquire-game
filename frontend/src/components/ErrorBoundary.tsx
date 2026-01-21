/**
 * Error Boundary Component
 * Catches JavaScript errors in child components and displays a fallback UI.
 */

import { Component, type ReactNode } from 'react'
import { Button } from './ui/Button'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null })
  }

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '200px',
            padding: 'var(--space-6)',
            textAlign: 'center',
            fontFamily: 'var(--font-primary)',
            color: 'var(--text-primary)',
            backgroundColor: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--border)',
          }}
        >
          <h2
            style={{
              fontSize: 'var(--text-lg)',
              marginBottom: 'var(--space-2)',
              color: 'var(--text-negative)',
            }}
          >
            Something went wrong
          </h2>
          <p
            style={{
              fontSize: 'var(--text-md)',
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-4)',
            }}
          >
            {this.state.error?.message || 'An unexpected error occurred'}
          </p>
          <Button variant="primary" onClick={this.handleRetry}>
            Try Again
          </Button>
        </div>
      )
    }

    return this.props.children
  }
}
