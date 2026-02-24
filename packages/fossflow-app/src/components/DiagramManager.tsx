import React, { useState, useEffect } from 'react';
import {
  Button,
  Heading,
  Text,
  Flash,
  Spinner,
  Label,
  TextInput,
  FormControl,
  IconButton
} from '@primer/react';
import { XIcon, CloudIcon, CheckCircleIcon, TrashIcon, LinkIcon } from '@primer/octicons-react';
import { storageManager, DiagramInfo } from '../services/storageService';

interface Props {
  onLoadDiagram: (id: string, data: any) => void;
  currentDiagramId?: string;
  currentDiagramData?: any;
  onClose: () => void;
}

export const DiagramManager: React.FC<Props> = ({
  onLoadDiagram,
  currentDiagramId,
  currentDiagramData,
  onClose
}) => {
  const [diagrams, setDiagrams] = useState<DiagramInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isServerStorage, setIsServerStorage] = useState(false);
  const [saveName, setSaveName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);

  useEffect(() => {
    loadDiagrams();
  }, []);

  const loadDiagrams = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('DiagramManager: Initializing storage...');
      // Initialize storage if not already done
      await storageManager.initialize();
      const isServer = storageManager.isServerStorage();
      setIsServerStorage(isServer);
      console.log(
        `DiagramManager: Using ${isServer ? 'server' : 'session'} storage`
      );

      // Load diagram list
      const storage = storageManager.getStorage();
      console.log('DiagramManager: Loading diagram list...');
      const list = await storage.listDiagrams();
      console.log(`DiagramManager: Loaded ${list.length} diagrams`);
      setDiagrams(list);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : 'Failed to load diagrams';
      console.error('DiagramManager error:', err);
      setError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      console.log(`DiagramManager: Loading diagram ${id}...`);

      const storage = storageManager.getStorage();
      const data = await storage.loadDiagram(id);

      console.log(`DiagramManager: Successfully loaded diagram ${id}`);
      onLoadDiagram(id, data);

      // Small delay to ensure parent component finishes state updates
      await new Promise((resolve) => {
        return setTimeout(resolve, 100);
      });

      onClose();
    } catch (err) {
      console.error(`DiagramManager: Failed to load diagram ${id}:`, err);
      setError(err instanceof Error ? err.message : 'Failed to load diagram');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this diagram?')) {
      return;
    }

    try {
      const storage = storageManager.getStorage();
      await storage.deleteDiagram(id);
      await loadDiagrams(); // Refresh list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete diagram');
    }
  };

  const handleCopyShareLink = (id: string) => {
    const shareUrl = `${window.location.origin}/display/${id}`;
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        alert(`Share link copied to clipboard:\n${shareUrl}`);
      })
      .catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = shareUrl;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');

        // Safely remove the temporary element
        try {
          if (textArea.parentNode === document.body) {
            document.body.removeChild(textArea);
          }
        } catch (err) {
          console.warn('Failed to remove temporary textarea:', err);
        }

        alert(`Share link copied to clipboard:\n${shareUrl}`);
      });
  };

  const handleSave = async () => {
    if (!saveName.trim()) {
      setError('Please enter a diagram name');
      return;
    }

    try {
      const storage = storageManager.getStorage();

      // Check if a diagram with this name already exists (excluding current diagram)
      const existingDiagram = diagrams.find((d) => {
        return d.name === saveName.trim() && d.id !== currentDiagramId;
      });

      if (existingDiagram) {
        const confirmOverwrite = window.confirm(
          `A diagram named "${saveName}" already exists. This will overwrite it. Are you sure you want to continue?`
        );
        if (!confirmOverwrite) {
          return;
        }

        // Delete the existing diagram first
        await storage.deleteDiagram(existingDiagram.id);
      }

      /**
       * Icon Persistence: Save ALL icons (default + imported)
       *
       * currentDiagramData comes from parent's currentModel/diagramData which includes:
       * - All default icon collections (isoflow, aws, gcp, azure, kubernetes)
       * - All imported custom icons (collection='imported')
       *
       * This ensures when loading, we have the complete icon set and don't lose
       * any custom imported icons.
       */
      const dataToSave = {
        ...currentDiagramData,
        name: saveName
      };

      console.log(
        `DiagramManager: Saving diagram with ${dataToSave.icons?.length || 0} icons`
      );
      const importedCount = (dataToSave.icons || []).filter((icon: any) => {
        return icon.collection === 'imported';
      }).length;
      console.log(`DiagramManager: Including ${importedCount} imported icons`);

      if (currentDiagramId) {
        // Update existing
        await storage.saveDiagram(currentDiagramId, dataToSave);
      } else {
        // Create new
        await storage.createDiagram(dataToSave);
      }

      setShowSaveDialog(false);
      setSaveName('');
      await loadDiagrams(); // Refresh list
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save diagram');
    }
  };

  return (
    <div className="fossflow-modal-overlay">
      <div className="fossflow-modal" style={{ width: '90%', maxWidth: '800px', maxHeight: '80vh', display: 'flex', flexDirection: 'column', position: 'relative' }}>
        {/* Header */}
        <div className="fossflow-modal-header">
          <Heading as="h2" sx={{ fontSize: 2, fontWeight: 'semibold' }}>Diagram Manager</Heading>
          <IconButton icon={XIcon} aria-label="Close" variant="invisible" onClick={onClose} />
        </div>

        {/* Storage badge */}
        <div
          style={{
            padding: '8px 16px',
            borderBottom: '1px solid var(--borderColor-default, #d1d9e0)',
            display: 'flex', alignItems: 'center', gap: '12px',
            backgroundColor: 'var(--bgColor-muted, #f6f8fa)'
          }}
        >
          <Label variant={isServerStorage ? 'accent' : 'attention'}>
            {isServerStorage ? '🌐 Server Storage' : '💾 Local Storage'}
          </Label>
          {isServerStorage && (
            <Text sx={{ fontSize: 1, color: 'fg.muted' }}>
              Diagrams are saved on the server and available across all devices
            </Text>
          )}
        </div>

        {error && (
          <div style={{ padding: '0 16px', marginTop: '12px' }}>
            <Flash variant="danger">{error}</Flash>
          </div>
        )}

        {/* Save action */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid var(--borderColor-default, #d1d9e0)' }}>
          <Button
            variant="primary"
            size="small"
            leadingVisual={CheckCircleIcon}
            onClick={() => {
              setSaveName(currentDiagramData?.name || 'Untitled Diagram');
              setShowSaveDialog(true);
            }}
          >
            Save Current Diagram
          </Button>
        </div>

        {/* Diagram list */}
        <div style={{ flex: 1, overflow: 'auto', padding: '16px' }}>
          {loading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '40px 0' }}>
              <Spinner size="medium" />
            </div>
          ) : diagrams.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <CloudIcon size={32} />
              <Text sx={{ display: 'block', mt: 2, color: 'fg.muted' }}>No saved diagrams</Text>
              <Text sx={{ display: 'block', fontSize: 1, color: 'fg.muted', mt: 1 }}>
                Save your current diagram to get started
              </Text>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {diagrams.map((diagram) => (
                <div
                  key={diagram.id}
                  className="fossflow-diagram-item"
                >
                  <div>
                    <Text sx={{ fontWeight: 'semibold', display: 'block' }}>{diagram.name}</Text>
                    <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                      Last modified: {diagram.lastModified.toLocaleString()}
                      {diagram.size && ` • ${(diagram.size / 1024).toFixed(1)} KB`}
                    </Text>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <Button
                      size="small"
                      variant="primary"
                      onClick={() => handleLoad(diagram.id)}
                      disabled={loading}
                    >
                      Load
                    </Button>
                    <Button
                      size="small"
                      leadingVisual={LinkIcon}
                      onClick={() => handleCopyShareLink(diagram.id)}
                    >
                      Share
                    </Button>
                    <Button
                      size="small"
                      variant="danger"
                      leadingVisual={TrashIcon}
                      onClick={() => handleDelete(diagram.id)}
                      disabled={loading}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Save Dialog (nested overlay) */}
        {showSaveDialog && (
          <div
            style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              borderRadius: '6px'
            }}
          >
            <div
              style={{
                backgroundColor: 'var(--bgColor-default, #ffffff)',
                borderRadius: '6px',
                border: '1px solid var(--borderColor-default, #d1d9e0)',
                boxShadow: '0 8px 24px rgba(140,149,159,0.2)',
                width: '340px', padding: '16px'
              }}
            >
              <Heading as="h3" sx={{ fontSize: 2, mb: 3 }}>Save Diagram</Heading>
              <FormControl>
                <FormControl.Label>Diagram name</FormControl.Label>
                <TextInput
                  block
                  placeholder="Diagram name"
                  value={saveName}
                  onChange={(e) => setSaveName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                  autoFocus
                />
              </FormControl>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                <Button onClick={() => setShowSaveDialog(false)}>Cancel</Button>
                <Button variant="primary" onClick={handleSave}>Save</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
