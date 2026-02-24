import { Button, Flash, Heading, Text } from '@primer/react';
import { AlertIcon, IssueOpenedIcon, SyncIcon } from '@primer/octicons-react';

interface ErrorBoundaryFallbackUIProps {
  error: Error;
}

export default function ErrorBoundaryFallbackUI({
  error
}: ErrorBoundaryFallbackUIProps) {
  const onRefreshButtonPressed = () => {
    window.location.reload();
  };

  const onReportButtonPressed = () => {
    const errorDetails = {
      message: error.message,
      stack: error.stack,
      userAgent: navigator.userAgent,
      url: window.location.href,
      timestamp: new Date().toISOString()
    };

    const githubUrl = new URL(
      'https://github.com/stan-smith/FossFLOW/issues/new'
    );
    githubUrl.searchParams.set('title', `Error: ${error.message}`);
    githubUrl.searchParams.set(
      'body',
      `## Error Details\n\n\`\`\`\n${JSON.stringify(errorDetails, null, 2)}\n\`\`\`\n\n## Steps to Reproduce\n1. \n2. \n3. \n\n## Expected Behavior\n\n## Actual Behavior\n\n## Environment\n- Browser: ${navigator.userAgent}\n- URL: ${window.location.href}\n- Timestamp: ${new Date().toISOString()}`
    );

    window.open(githubUrl.toString(), '_blank');
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: 'var(--bgColor-inset, #f6f8fa)'
      }}
    >
      <div
        style={{
          width: '480px',
          maxWidth: '95vw',
          backgroundColor: 'var(--bgColor-default, #ffffff)',
          borderRadius: '6px',
          border: '1px solid var(--borderColor-default, #d1d9e0)',
          boxShadow: '0 8px 24px rgba(140,149,159,0.2)',
          padding: '32px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
          <AlertIcon size={24} fill="var(--fgColor-danger, #cf222e)" />
          <Heading as="h2" sx={{ fontSize: 3, color: 'danger.fg' }}>
            Something went wrong
          </Heading>
        </div>

        <Flash variant="danger" sx={{ mb: 3 }}>
          <Text sx={{ fontWeight: 'semibold' }}>Error:</Text> {error.message}
          {error.stack && (
            <details style={{ marginTop: '8px' }}>
              <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--fgColor-muted, #656d76)' }}>
                Show technical details
              </summary>
              <pre
                style={{
                  fontSize: '11px',
                  color: 'var(--fgColor-muted, #656d76)',
                  marginTop: '8px',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: '180px',
                  overflow: 'auto'
                }}
              >
                {error.stack}
              </pre>
            </details>
          )}
        </Flash>

        <Flash variant="default" sx={{ mb: 4, fontSize: 1 }}>
          <Text sx={{ fontWeight: 'semibold', display: 'block', mb: 1 }}>
            📋 Before reporting this error:
          </Text>
          <ul style={{ paddingLeft: '20px', margin: 0 }}>
            <li>
              Check if this error has already been reported{' '}
              <a
                href="https://github.com/stan-smith/FossFLOW/issues"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--fgColor-accent, #0969da)' }}
              >
                here
              </a>
            </li>
            <li>Try refreshing the page first</li>
            <li>Only report if this is a new, unreported issue</li>
          </ul>
        </Flash>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
          <Button leadingVisual={IssueOpenedIcon} onClick={onReportButtonPressed}>
            Report Issue
          </Button>
          <Button variant="primary" leadingVisual={SyncIcon} onClick={onRefreshButtonPressed}>
            Refresh Page
          </Button>
        </div>
      </div>
    </div>
  );
}
