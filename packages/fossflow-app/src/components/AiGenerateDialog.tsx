import React, { useState } from 'react';
import {
  Button,
  FormControl,
  Textarea,
  Text,
  Heading,
  Flash,
  IconButton,
  Label
} from '@primer/react';
import { XIcon, CopilotIcon, AlertIcon } from '@primer/octicons-react';
import { loadBedrockConfig } from './BedrockSettings';

interface Props {
  onClose: () => void;
  onDiagramGenerated: (diagramData: any) => void;
  currentDiagramData?: any;
}

const isDevelopment =
  typeof window !== 'undefined' &&
  window.location.hostname === 'localhost' &&
  window.location.port === '3000';

const BACKEND_BASE = isDevelopment ? 'http://localhost:3001' : '';

async function generateDiagramFromAI(
  prompt: string,
  currentDiagram?: any
): Promise<any> {
  const config = loadBedrockConfig();
  if (!config || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error(
      'Amazon Bedrock credentials are not configured. Please set up your API key in Bedrock Settings.'
    );
  }

  const response = await fetch(`${BACKEND_BASE}/api/bedrock/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      currentDiagram,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        region: config.region,
        modelId: config.modelId
      }
    }),
    signal: AbortSignal.timeout(60000)
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(errorData.error || `HTTP error ${response.status}`);
  }

  return response.json();
}

export const AiGenerateDialog: React.FC<Props> = ({
  onClose,
  onDiagramGenerated,
  currentDiagramData
}) => {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasCredentials = Boolean(loadBedrockConfig()?.accessKeyId);

  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setError('Please describe the diagram you want to create');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const result = await generateDiagramFromAI(prompt, currentDiagramData);
      onDiagramGenerated(result);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate diagram');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fossflow-modal-overlay">
      <div className="fossflow-modal" style={{ width: '560px' }}>
        {/* Header */}
        <div
          className="fossflow-modal-header"
          style={{
            background: 'linear-gradient(135deg, #0d1117 0%, #161b22 100%)',
            color: 'white'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CopilotIcon size={20} fill="#a371f7" />
            <Heading as="h2" sx={{ fontSize: 2, fontWeight: 'semibold', color: 'white' }}>
              Generate Diagram with AI
            </Heading>
            <Label variant="accent" sx={{ fontSize: 0 }}>
              Claude via Bedrock
            </Label>
          </div>
          <IconButton
            icon={XIcon}
            aria-label="Close"
            variant="invisible"
            onClick={onClose}
            sx={{ color: 'white' }}
          />
        </div>

        {/* Body */}
        <div className="fossflow-modal-body">
          {!hasCredentials && (
            <Flash variant="warning" sx={{ mb: 3 }}>
              <AlertIcon size={16} /> Amazon Bedrock credentials are not configured. Please set
              up your API key in{' '}
              <Text sx={{ fontWeight: 'semibold' }}>Bedrock Settings</Text> before using this
              feature.
            </Flash>
          )}

          {error && (
            <Flash variant="danger" sx={{ mb: 3 }}>
              <AlertIcon size={16} /> {error}
            </Flash>
          )}

          <FormControl>
            <FormControl.Label>Describe your diagram</FormControl.Label>
            <Textarea
              block
              rows={6}
              placeholder={`Examples:
• Create a 3-tier web architecture with load balancer, web servers, and a database
• Show a microservices architecture with API gateway, auth service, and product catalog
• Design a CI/CD pipeline from developer to production
• Draw a network diagram for a small office with VPN and firewall`}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              disabled={loading}
              sx={{ fontFamily: 'inherit', fontSize: 1, resize: 'vertical' }}
            />
            <FormControl.Caption>
              {currentDiagramData?.items?.length > 0
                ? 'AI will build upon your existing diagram. Describe what to add or change.'
                : 'Describe the infrastructure or system diagram you want to create.'}
            </FormControl.Caption>
          </FormControl>

          <div
            style={{
              marginTop: '16px',
              padding: '12px',
              backgroundColor: 'var(--bgColor-muted, #f6f8fa)',
              borderRadius: '6px',
              border: '1px solid var(--borderColor-muted, #d1d9e0)'
            }}
          >
            <Text sx={{ fontSize: 1, color: 'fg.muted', fontWeight: 'semibold', display: 'block', mb: 1 }}>
              Tips for best results:
            </Text>
            <ul style={{ fontSize: '13px', color: 'var(--fgColor-muted, #656d76)', paddingLeft: '20px', margin: 0 }}>
              <li>Be specific about components and connections</li>
              <li>Mention the type of architecture (cloud, network, microservices)</li>
              <li>Include scale details (number of servers, regions, etc.)</li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="fossflow-modal-footer">
          <div style={{ flexGrow: 1 }} />
          <Button onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleGenerate}
            disabled={loading || !hasCredentials || !prompt.trim()}
          >
            {loading ? 'Generating...' : 'Generate Diagram'}
          </Button>
        </div>
      </div>
    </div>
  );
};
