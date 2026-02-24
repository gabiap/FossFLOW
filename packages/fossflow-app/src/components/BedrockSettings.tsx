import React, { useState } from 'react';
import {
  Button,
  FormControl,
  TextInput,
  Text,
  Heading,
  Flash,
  IconButton,
  Select
} from '@primer/react';
import { XIcon, KeyIcon, CheckCircleIcon } from '@primer/octicons-react';

export interface BedrockConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  modelId: string;
}

const BEDROCK_REGIONS = [
  'us-east-1',
  'us-west-2',
  'ap-southeast-1',
  'ap-northeast-1',
  'eu-west-1',
  'eu-central-1'
];

const BEDROCK_MODELS = [
  { id: 'anthropic.claude-3-5-sonnet-20241022-v2:0', label: 'Claude 3.5 Sonnet v2' },
  { id: 'anthropic.claude-3-5-haiku-20241022-v1:0', label: 'Claude 3.5 Haiku' },
  { id: 'anthropic.claude-3-sonnet-20240229-v1:0', label: 'Claude 3 Sonnet' },
  { id: 'anthropic.claude-3-haiku-20240307-v1:0', label: 'Claude 3 Haiku' }
];

const STORAGE_KEY = 'fossflow-bedrock-config';

export function loadBedrockConfig(): BedrockConfig | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {
    // ignore
  }
  return null;
}

export function saveBedrockConfig(config: BedrockConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

interface Props {
  onClose: () => void;
}

export const BedrockSettings: React.FC<Props> = ({ onClose }) => {
  const [config, setConfig] = useState<BedrockConfig>(() => {
    return loadBedrockConfig() || {
      accessKeyId: '',
      secretAccessKey: '',
      region: 'us-east-1',
      modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
    };
  });
  const [errors, setErrors] = useState<Partial<Record<keyof BedrockConfig, string>>>({});
  const [saved, setSaved] = useState(false);

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof BedrockConfig, string>> = {};

    if (!config.accessKeyId.trim()) {
      newErrors.accessKeyId = 'AWS Access Key ID is required';
    } else if (!/^[A-Z0-9]{20}$/.test(config.accessKeyId.trim())) {
      newErrors.accessKeyId = 'Access Key ID must be 20 uppercase alphanumeric characters';
    }

    if (!config.secretAccessKey.trim()) {
      newErrors.secretAccessKey = 'AWS Secret Access Key is required';
    } else if (config.secretAccessKey.trim().length < 40) {
      newErrors.secretAccessKey = 'Secret Access Key must be at least 40 characters';
    }

    if (!config.region) {
      newErrors.region = 'AWS Region is required';
    }

    if (!config.modelId) {
      newErrors.modelId = 'Model ID is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (validate()) {
      saveBedrockConfig(config);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }
  };

  const handleClear = () => {
    localStorage.removeItem(STORAGE_KEY);
    setConfig({
      accessKeyId: '',
      secretAccessKey: '',
      region: 'us-east-1',
      modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0'
    });
    setErrors({});
  };

  return (
    <div className="fossflow-modal-overlay">
      <div className="fossflow-modal" style={{ width: '480px' }}>
        {/* Header */}
        <div className="fossflow-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <KeyIcon size={20} />
            <Heading as="h2" sx={{ fontSize: 2, fontWeight: 'semibold' }}>
              Amazon Bedrock API Settings
            </Heading>
          </div>
          <IconButton
            icon={XIcon}
            aria-label="Close"
            variant="invisible"
            onClick={onClose}
          />
        </div>

        {/* Body */}
        <div className="fossflow-modal-body">
          <Flash variant="default" sx={{ mb: 3, fontSize: 1 }}>
            Your credentials are stored locally in your browser and never sent to any server
            other than Amazon AWS directly. Enable Amazon Bedrock model access in your AWS
            console before using this feature.
          </Flash>

          {saved && (
            <Flash variant="success" sx={{ mb: 3 }}>
              <CheckCircleIcon size={16} /> Settings saved successfully
            </Flash>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <FormControl>
              <FormControl.Label>AWS Access Key ID</FormControl.Label>
              <TextInput
                block
                placeholder="AKIAIOSFODNN7EXAMPLE"
                value={config.accessKeyId}
                onChange={(e) => setConfig({ ...config, accessKeyId: e.target.value })}
                validationStatus={errors.accessKeyId ? 'error' : undefined}
              />
              {errors.accessKeyId && (
                <FormControl.Validation variant="error">
                  {errors.accessKeyId}
                </FormControl.Validation>
              )}
            </FormControl>

            <FormControl>
              <FormControl.Label>AWS Secret Access Key</FormControl.Label>
              <TextInput
                block
                type="password"
                placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
                value={config.secretAccessKey}
                onChange={(e) => setConfig({ ...config, secretAccessKey: e.target.value })}
                validationStatus={errors.secretAccessKey ? 'error' : undefined}
              />
              {errors.secretAccessKey && (
                <FormControl.Validation variant="error">
                  {errors.secretAccessKey}
                </FormControl.Validation>
              )}
            </FormControl>

            <FormControl>
              <FormControl.Label>AWS Region</FormControl.Label>
              <Select
                value={config.region}
                onChange={(e) => setConfig({ ...config, region: e.target.value })}
              >
                {BEDROCK_REGIONS.map((r) => (
                  <Select.Option key={r} value={r}>
                    {r}
                  </Select.Option>
                ))}
              </Select>
            </FormControl>

            <FormControl>
              <FormControl.Label>Claude Model</FormControl.Label>
              <Select
                value={config.modelId}
                onChange={(e) => setConfig({ ...config, modelId: e.target.value })}
              >
                {BEDROCK_MODELS.map((m) => (
                  <Select.Option key={m.id} value={m.id}>
                    {m.label}
                  </Select.Option>
                ))}
              </Select>
              <FormControl.Caption>
                Model must be enabled in your AWS Bedrock console
              </FormControl.Caption>
            </FormControl>
          </div>
        </div>

        {/* Footer */}
        <div className="fossflow-modal-footer">
          <Button variant="danger" onClick={handleClear}>
            Clear credentials
          </Button>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" onClick={handleSave}>
              Save settings
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
};
