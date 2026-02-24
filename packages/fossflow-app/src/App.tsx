import React, { useState, useEffect, useRef } from 'react';
import { Isoflow } from 'fossflow';
import { flattenCollections } from '@isoflow/isopacks/dist/utils';
import isoflowIsopack from '@isoflow/isopacks/dist/isoflow';
import { useTranslation } from 'react-i18next';
import {
  DiagramData,
  mergeDiagramData,
  extractSavableData
} from './diagramUtils';
import { StorageManager } from './StorageManager';
import { DiagramManager } from './components/DiagramManager';
import { BedrockSettings } from './components/BedrockSettings';
import { AiGenerateDialog } from './components/AiGenerateDialog';
import { storageManager } from './services/storageService';
import ChangeLanguage from './components/ChangeLanguage';
import { allLocales } from 'fossflow';
import { useIconPackManager, IconPackName } from './services/iconPackManager';
import {
  Button,
  Text,
  Flash,
  TextInput,
  FormControl,
  Heading,
  Label
} from '@primer/react';
import {
  FileIcon,
  DownloadIcon,
  UploadIcon,
  DatabaseIcon,
  EyeIcon,
  CopilotIcon,
  KeyIcon
} from '@primer/octicons-react';
import './App.css';
import { BrowserRouter, Route, Routes, useParams } from 'react-router-dom';

// Load core isoflow icons (always loaded)
const coreIcons = flattenCollections([isoflowIsopack]);

interface SavedDiagram {
  id: string;
  name: string;
  data: any;
  createdAt: string;
  updatedAt: string;
}

function App() {
  // Get base path from PUBLIC_URL, ensure no trailing slash for React Router
  const publicUrl = process.env.PUBLIC_URL || '';
  // React Router basename should not have trailing slash
  const basename = publicUrl ? (publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl) : '/';

  return (
    <BrowserRouter basename={basename}>
      <Routes>
        <Route path="/" element={<EditorPage />} />
        <Route path="/display/:readonlyDiagramId" element={<EditorPage />} />
      </Routes>
    </BrowserRouter>
  );
}

function EditorPage() {
  // Initialize icon pack manager with core icons
  const iconPackManager = useIconPackManager(coreIcons);
  const { readonlyDiagramId } = useParams<{ readonlyDiagramId: string }>();

  const [diagrams, setDiagrams] = useState<SavedDiagram[]>([]);
  const [isDiagramsInitialized, setIsDiagramsInitialized] = useState<boolean>(false);
  const [currentDiagram, setCurrentDiagram] = useState<SavedDiagram | null>(
    null
  );
  const [diagramName, setDiagramName] = useState('');
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [showLoadDialog, setShowLoadDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [fossflowKey, setFossflowKey] = useState(0); // Key to force re-render of FossFLOW
  const [currentModel, setCurrentModel] = useState<DiagramData | null>(null); // Store current model state
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastAutoSave, setLastAutoSave] = useState<Date | null>(null);
  const [showStorageManager, setShowStorageManager] = useState(false);
  const [showDiagramManager, setShowDiagramManager] = useState(false);
  const [serverStorageAvailable, setServerStorageAvailable] = useState(false);
  const [showBedrockSettings, setShowBedrockSettings] = useState(false);
  const [showAiGenerate, setShowAiGenerate] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isReadonlyUrl =
    window.location.pathname.startsWith('/display/') && readonlyDiagramId;

  // Initialize with empty diagram data
  // Create default colors for connectors
  const defaultColors = [
    { id: 'blue', value: '#0066cc' },
    { id: 'green', value: '#00aa00' },
    { id: 'red', value: '#cc0000' },
    { id: 'orange', value: '#ff9900' },
    { id: 'purple', value: '#9900cc' },
    { id: 'black', value: '#000000' },
    { id: 'gray', value: '#666666' }
  ];

  const [diagramData, setDiagramData] = useState<DiagramData>(() => {
    // Initialize with last opened data if available
    const lastOpenedData = localStorage.getItem('fossflow-last-opened-data');
    if (lastOpenedData) {
      try {
        const data = JSON.parse(lastOpenedData);
        const importedIcons = (data.icons || []).filter((icon: any) => {
          return icon.collection === 'imported';
        });
        const mergedIcons = [...coreIcons, ...importedIcons];
        return {
          ...data,
          icons: mergedIcons,
          colors: data.colors?.length ? data.colors : defaultColors,
          fitToScreen: data.fitToScreen !== false
        };
      } catch (e) {
        console.error('Failed to load last opened data:', e);
      }
    }

    // Default state if no saved data
    return {
      title: 'Untitled Diagram',
      icons: coreIcons,
      colors: defaultColors,
      items: [],
      views: [],
      fitToScreen: true
    };
  });

  // Check for server storage availability
  useEffect(() => {
    storageManager
      .initialize()
      .then(() => {
        setServerStorageAvailable(storageManager.isServerStorage());
      })
      .catch(console.error);
  }, []);

  // Check if readonlyDiagramId exists - if exists, load diagram in view-only mode
  useEffect(() => {
    if (!isReadonlyUrl || !serverStorageAvailable) return;
    const loadReadonlyDiagram = async () => {
      try {
        const storage = storageManager.getStorage();
        // Get diagram metadata
        const diagramList = await storage.listDiagrams();
        const diagramInfo = diagramList.find((d) => {
          return d.id === readonlyDiagramId;
        });
        // Load the diagram data from server storage
        const data = await storage.loadDiagram(readonlyDiagramId);
        // Convert to SavedDiagram interface format
        const readonlyDiagram: SavedDiagram = {
          id: readonlyDiagramId,
          name: diagramInfo?.name || data.title || 'Readonly Diagram',
          data: data,
          createdAt: new Date().toISOString(),
          updatedAt:
            diagramInfo?.lastModified.toISOString() || new Date().toISOString()
        };
        await loadDiagram(readonlyDiagram, true);
      } catch (error) {
        // Alert if unable to load readonly diagram and redirect to new diagram
        alert(t('dialog.readOnly.failed'));
        window.location.href = '/';
      }
    };
    loadReadonlyDiagram();
  }, [readonlyDiagramId, serverStorageAvailable]);

  // Update diagramData when loaded icons change
  useEffect(() => {
    setDiagramData((prev) => {
      return {
        ...prev,
        icons: [
          ...iconPackManager.loadedIcons,
          ...(prev.icons || []).filter((icon) => {
            return icon.collection === 'imported';
          })
        ]
      };
    });
  }, [iconPackManager.loadedIcons]);

  // Load diagrams from localStorage on component mount
  useEffect(() => {
    const savedDiagrams = localStorage.getItem('fossflow-diagrams');
    if (savedDiagrams) {
      setDiagrams(JSON.parse(savedDiagrams));
      setIsDiagramsInitialized(true);
    }

    // Load last opened diagram metadata (data is already loaded in state initialization)
    const lastOpenedId = localStorage.getItem('fossflow-last-opened');

    if (lastOpenedId && savedDiagrams) {
      try {
        const allDiagrams = JSON.parse(savedDiagrams);
        const lastDiagram = allDiagrams.find((d: SavedDiagram) => {
          return d.id === lastOpenedId;
        });
        if (lastDiagram) {
          setCurrentDiagram(lastDiagram);
          setDiagramName(lastDiagram.name);
          // Also set currentModel to match diagramData
          setCurrentModel(diagramData);
        }
      } catch (e) {
        console.error('Failed to restore last diagram metadata:', e);
      }
    }
  }, []);

  // Save diagrams to localStorage whenever they change
  useEffect(() => {
    if (!isDiagramsInitialized) return;

    try {
      // Store diagrams without the full icon data
      const diagramsToStore = diagrams.map((d) => {
        return {
          ...d,
          data: {
            ...d.data,
            icons: [] // Don't store icons with each diagram
          }
        };
      });
      localStorage.setItem(
        'fossflow-diagrams',
        JSON.stringify(diagramsToStore)
      );
    } catch (e) {
      console.error('Failed to save diagrams:', e);
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        alert(t('alert.quotaExceeded'));
      }
    }
  }, [diagrams]);

  const saveDiagram = () => {
    if (!diagramName.trim()) {
      alert(t('alert.enterDiagramName'));
      return;
    }

    // Check if a diagram with this name already exists (excluding current)
    const existingDiagram = diagrams.find((d) => {
      return d.name === diagramName.trim() && d.id !== currentDiagram?.id;
    });

    if (existingDiagram) {
      const confirmOverwrite = window.confirm(
        t('alert.diagramExists', { name: diagramName })
      );
      if (!confirmOverwrite) {
        return;
      }
    }

    // Construct save data - include only imported icons
    const importedIcons = (
      currentModel?.icons ||
      diagramData.icons ||
      []
    ).filter((icon) => {
      return icon.collection === 'imported';
    });

    const savedData = {
      title: diagramName,
      icons: importedIcons, // Save only imported icons with diagram
      colors: currentModel?.colors || diagramData.colors || [],
      items: currentModel?.items || diagramData.items || [],
      views: currentModel?.views || diagramData.views || [],
      fitToScreen: true
    };

    const newDiagram: SavedDiagram = {
      id: currentDiagram?.id || Date.now().toString(),
      name: diagramName,
      data: savedData,
      createdAt: currentDiagram?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (currentDiagram) {
      // Update existing diagram
      setDiagrams(
        diagrams.map((d) => {
          return d.id === currentDiagram.id ? newDiagram : d;
        })
      );
    } else if (existingDiagram) {
      // Replace existing diagram with same name
      setDiagrams(
        diagrams.map((d) => {
          return d.id === existingDiagram.id
            ? {
                ...newDiagram,
                id: existingDiagram.id,
                createdAt: existingDiagram.createdAt
              }
            : d;
        })
      );
      newDiagram.id = existingDiagram.id;
      newDiagram.createdAt = existingDiagram.createdAt;
    } else {
      // Add new diagram
      setDiagrams([...diagrams, newDiagram]);
    }

    setCurrentDiagram(newDiagram);
    setShowSaveDialog(false);
    setHasUnsavedChanges(false);
    setLastAutoSave(new Date());

    // Save as last opened
    try {
      localStorage.setItem('fossflow-last-opened', newDiagram.id);
      localStorage.setItem(
        'fossflow-last-opened-data',
        JSON.stringify(newDiagram.data)
      );
    } catch (e) {
      console.error('Failed to save diagram:', e);
      if (e instanceof DOMException && e.name === 'QuotaExceededError') {
        alert(t('alert.storageFull'));
        setShowStorageManager(true);
      }
    }
  };

  const loadDiagram = async (
    diagram: SavedDiagram,
    skipUnsavedCheck = false
  ) => {
    if (
      !skipUnsavedCheck &&
      hasUnsavedChanges &&
      !window.confirm(t('alert.unsavedChanges'))
    ) {
      return;
    }

    // Auto-detect and load required icon packs
    await iconPackManager.loadPacksForDiagram(diagram.data.items || []);

    // Merge imported icons with loaded icon set
    const importedIcons = (diagram.data.icons || []).filter((icon: any) => {
      return icon.collection === 'imported';
    });
    const mergedIcons = [...iconPackManager.loadedIcons, ...importedIcons];
    const dataWithIcons = {
      ...diagram.data,
      icons: mergedIcons
    };

    setCurrentDiagram(diagram);
    setDiagramName(diagram.name);
    setDiagramData(dataWithIcons);
    setCurrentModel(dataWithIcons);
    setFossflowKey((prev) => {
      return prev + 1;
    }); // Force re-render of FossFLOW
    setShowLoadDialog(false);
    setHasUnsavedChanges(false);

    // Save as last opened (without icons)
    try {
      localStorage.setItem('fossflow-last-opened', diagram.id);
      localStorage.setItem(
        'fossflow-last-opened-data',
        JSON.stringify(diagram.data)
      );
    } catch (e) {
      console.error('Failed to save last opened:', e);
    }
  };

  const deleteDiagram = (id: string) => {
    if (window.confirm(t('alert.confirmDelete'))) {
      setDiagrams(
        diagrams.filter((d) => {
          return d.id !== id;
        })
      );
      if (currentDiagram?.id === id) {
        setCurrentDiagram(null);
        setDiagramName('');
      }
    }
  };

  const newDiagram = () => {
    const message = hasUnsavedChanges
      ? t('alert.unsavedChangesExport')
      : t('alert.createNewDiagram');

    if (window.confirm(message)) {
      const emptyDiagram: DiagramData = {
        title: 'Untitled Diagram',
        icons: iconPackManager.loadedIcons, // Use currently loaded icons
        colors: defaultColors,
        items: [],
        views: [],
        fitToScreen: true
      };
      setCurrentDiagram(null);
      setDiagramName('');
      setDiagramData(emptyDiagram);
      setCurrentModel(emptyDiagram); // Reset current model too
      setFossflowKey((prev) => {
        return prev + 1;
      }); // Force re-render of FossFLOW
      setHasUnsavedChanges(false);

      // Clear last opened
      localStorage.removeItem('fossflow-last-opened');
      localStorage.removeItem('fossflow-last-opened-data');
    }
  };

  const handleModelUpdated = (model: any) => {
    // Store the current model state whenever it updates
    // The model from Isoflow contains the COMPLETE state including all icons

    // Simply store the complete model as-is since it has everything
    const updatedModel = {
      title: model.title || diagramName || 'Untitled',
      icons: model.icons || [], // This already includes ALL icons (default + imported)
      colors: model.colors || defaultColors,
      items: model.items || [],
      views: model.views || [],
      fitToScreen: true
    };

    setCurrentModel(updatedModel);
    setDiagramData(updatedModel);

    if (!isReadonlyUrl) {
      setHasUnsavedChanges(true);
    }
  };

  const exportDiagram = () => {
    // Use the most recent model data - prefer currentModel as it gets updated by handleModelUpdated
    const modelToExport = currentModel || diagramData;

    // Get ALL icons from the current model (which includes both default and imported)
    const allModelIcons = modelToExport.icons || [];

    // For safety, also check diagramData for any imported icons not in currentModel
    const diagramImportedIcons = (diagramData.icons || []).filter((icon) => {
      return icon.collection === 'imported';
    });

    // Create a map to deduplicate icons by ID, preferring the ones from currentModel
    const iconMap = new Map();

    // First add all icons from the model (includes defaults + imported)
    allModelIcons.forEach((icon) => {
      iconMap.set(icon.id, icon);
    });

    // Then add any imported icons from diagramData that might be missing
    diagramImportedIcons.forEach((icon) => {
      if (!iconMap.has(icon.id)) {
        iconMap.set(icon.id, icon);
      }
    });

    // Get all unique icons
    const allIcons = Array.from(iconMap.values());

    const exportData = {
      title: diagramName || modelToExport.title || 'Exported Diagram',
      icons: allIcons, // Include ALL icons (default + imported) for portability
      colors: modelToExport.colors || [],
      items: modelToExport.items || [],
      views: modelToExport.views || [],
      fitToScreen: true
    };

    const jsonString = JSON.stringify(exportData, null, 2);

    // Create a blob and download link
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${diagramName || 'diagram'}-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);

    setShowExportDialog(false);
    setHasUnsavedChanges(false); // Mark as saved after export
  };

  const importDiagram = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);
        const importedData = parsed.data || parsed;
        const mergedData = mergeDiagramData(diagramData, importedData);
        setDiagramData(mergedData);
        setCurrentModel(mergedData);
        setDiagramName(parsed.name || importedData.title || '');
        setHasUnsavedChanges(true);
        setFossflowKey((k) => k + 1);
      } catch (err) {
        console.error('Failed to import diagram:', err);
        alert('Failed to import diagram. Please check the file format.');
      }
    };
    reader.readAsText(file);
    // Reset input so the same file can be re-imported
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDiagramManagerLoad = async (id: string, data: any) => {
    console.log(`App: handleDiagramManagerLoad called for diagram ${id}`);

    /**
     * Icon Persistence Strategy:
     *
     * NEW BEHAVIOR (after this fix):
     * - Server storage saves ALL icons (default collections + imported custom icons)
     * - When loading, if we detect default collection icons, use ALL icons from server
     * - This preserves imported custom icons without data loss
     *
     * BACKWARD COMPATIBILITY (for old saves):
     * - Old format only saved imported icons (collection='imported')
     * - If no default icons detected, merge imported icons with current defaults
     * - This ensures old diagrams still load correctly
     *
     * DETECTION:
     * - Check if loaded icons contain any default collection (isoflow, aws, gcp, etc.)
     * - If yes: New format, use all icons from server
     * - If no: Old format, merge imported with defaults
     */
    const loadedIcons = data.icons || [];
    console.log(`App: Server sent ${loadedIcons.length} icons`);

    // Auto-detect and load required icon packs
    await iconPackManager.loadPacksForDiagram(data.items || []);

    // Strategy: Check if server has ALL icons (both default and imported)
    // Server storage now saves ALL icons, so we should use them directly
    // For backward compatibility with old saves, we detect and merge

    let finalIcons;
    const hasDefaultIcons = loadedIcons.some((icon: any) => {
      return (
        icon.collection === 'isoflow' ||
        icon.collection === 'aws' ||
        icon.collection === 'gcp'
      );
    });

    if (hasDefaultIcons) {
      // New format: Server saved ALL icons (default + imported)
      // Use them directly to preserve any custom icon modifications
      console.log(
        `App: Using all ${loadedIcons.length} icons from server (includes defaults + imported)`
      );
      finalIcons = loadedIcons;
    } else {
      // Old format: Server only saved imported icons
      // Merge imported icons with currently loaded icon packs
      const importedIcons = loadedIcons.filter((icon: any) => {
        return icon.collection === 'imported';
      });
      finalIcons = [...iconPackManager.loadedIcons, ...importedIcons];
      console.log(
        `App: Old format detected. Merged ${importedIcons.length} imported icons with ${iconPackManager.loadedIcons.length} defaults = ${finalIcons.length} total`
      );
    }

    const mergedData: DiagramData = {
      ...data,
      title: data.title || data.name || 'Loaded Diagram',
      icons: finalIcons,
      colors: data.colors?.length ? data.colors : defaultColors,
      fitToScreen: data.fitToScreen !== false
    };

    const newDiagram = {
      id,
      name: data.name || 'Loaded Diagram',
      data: mergedData,
      createdAt: data.created || new Date().toISOString(),
      updatedAt: data.lastModified || new Date().toISOString()
    };

    console.log(`App: Setting all state for diagram ${id}`);

    // Use a single batch of state updates to minimize re-render issues
    // Update diagram data and increment key in the same render cycle
    setDiagramName(newDiagram.name);
    setCurrentDiagram(newDiagram);
    setCurrentModel(mergedData);
    setHasUnsavedChanges(false);

    // Update diagramData and key together
    // This ensures Isoflow gets the correct data with the new key
    setDiagramData(mergedData);
    setFossflowKey((prev) => {
      const newKey = prev + 1;
      console.log(`App: Updated fossflowKey from ${prev} to ${newKey}`);
      return newKey;
    });

    console.log(
      `App: Finished loading diagram ${id}, final icon count: ${finalIcons.length}`
    );
  };

  // i18n
  const { t, i18n } = useTranslation('app');
  
  // Get locale with fallback to en-US if not found
  const currentLocale = allLocales[i18n.language as keyof typeof allLocales] || allLocales['en-US'];

  // Auto-save functionality
  useEffect(() => {
    if (!currentModel || !hasUnsavedChanges || !currentDiagram) return;

    const autoSaveTimer = setTimeout(() => {
      // Include imported icons in auto-save
      const importedIcons = (
        currentModel?.icons ||
        diagramData.icons ||
        []
      ).filter((icon) => {
        return icon.collection === 'imported';
      });

      const savedData = {
        title: diagramName || currentDiagram.name,
        icons: importedIcons, // Save imported icons in auto-save
        colors: currentModel.colors || [],
        items: currentModel.items || [],
        views: currentModel.views || [],
        fitToScreen: true
      };

      const updatedDiagram: SavedDiagram = {
        ...currentDiagram,
        data: savedData,
        updatedAt: new Date().toISOString()
      };

      setDiagrams((prevDiagrams) => {
        return prevDiagrams.map((d) => {
          return d.id === currentDiagram.id ? updatedDiagram : d;
        });
      });

      // Update last opened data
      try {
        localStorage.setItem(
          'fossflow-last-opened-data',
          JSON.stringify(savedData)
        );
        setLastAutoSave(new Date());
        setHasUnsavedChanges(false);
      } catch (e) {
        console.error('Auto-save failed:', e);
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
          alert(t('alert.autoSaveFailed'));
          setShowStorageManager(true);
        }
      }
    }, 5000); // Auto-save after 5 seconds of changes

    return () => {
      return clearTimeout(autoSaveTimer);
    };
  }, [currentModel, hasUnsavedChanges, currentDiagram, diagramName]);

  // Warn before closing if there are unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = t('alert.beforeUnload');
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      return window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [hasUnsavedChanges]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+S or Cmd+S for Save
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();

        // Quick save if current diagram exists and has unsaved changes
        if (currentDiagram && hasUnsavedChanges) {
          saveDiagram();
        } else {
          // Otherwise show save dialog
          setShowSaveDialog(true);
        }
      }

      // Ctrl+O or Cmd+O for Open/Load
      if ((e.ctrlKey || e.metaKey) && e.key === 'o') {
        e.preventDefault();
        setShowLoadDialog(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      return window.removeEventListener('keydown', handleKeyDown);
    };
  }, [currentDiagram, hasUnsavedChanges]);

  return (
    <div className="App">
      <header className="fossflow-header">
        {/* FossFLOW brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginRight: '8px' }}>
          <Text sx={{ fontWeight: 'bold', fontSize: 2, color: 'accent.fg' }}>
            FossFLOW
          </Text>
        </div>

        {!isReadonlyUrl && (
          <>
            <Button size="small" leadingVisual={FileIcon} onClick={newDiagram}>
              {t('nav.newDiagram')}
            </Button>

            {serverStorageAvailable && (
              <Button
                size="small"
                leadingVisual={DatabaseIcon}
                variant="primary"
                onClick={() => setShowDiagramManager(true)}
              >
                {t('nav.serverStorage')}
              </Button>
            )}

            <Button size="small" onClick={() => setShowSaveDialog(true)}>
              {t('nav.saveSessionOnly')}
            </Button>

            <Button size="small" onClick={() => setShowLoadDialog(true)}>
              {t('nav.loadSessionOnly')}
            </Button>

            <Button
              size="small"
              leadingVisual={DownloadIcon}
              onClick={() => setShowExportDialog(true)}
            >
              {t('nav.exportFile')}
            </Button>

            <Button
              size="small"
              leadingVisual={UploadIcon}
              onClick={() => fileInputRef.current?.click()}
            >
              {t('nav.importFile')}
            </Button>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={importDiagram}
            />

            <Button
              size="small"
              onClick={() => {
                if (currentDiagram && hasUnsavedChanges) {
                  saveDiagram();
                }
              }}
              disabled={!currentDiagram || !hasUnsavedChanges}
            >
              {t('nav.quickSaveSession')}
            </Button>

            {/* AI & Settings section */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '4px' }}>
              <Button
                size="small"
                leadingVisual={CopilotIcon}
                variant="invisible"
                onClick={() => setShowAiGenerate(true)}
                title="Generate diagram with Claude AI via Amazon Bedrock"
              >
                AI Generate
              </Button>
              <Button
                size="small"
                leadingVisual={KeyIcon}
                variant="invisible"
                onClick={() => setShowBedrockSettings(true)}
                title="Amazon Bedrock API settings"
              >
                Bedrock
              </Button>
            </div>
          </>
        )}

        {isReadonlyUrl && (
          <Label variant="attention" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <EyeIcon size={14} />
            {t('dialog.readOnly.mode')}
          </Label>
        )}

        {/* Spacer */}
        <div style={{ flexGrow: 1 }} />

        {/* Diagram info */}
        <Text sx={{ fontSize: 1, color: 'fg.muted' }}>
          {isReadonlyUrl ? (
            `${t('status.current')}: ${diagramName}`
          ) : (
            <>
              {currentDiagram
                ? `${t('status.current')}: ${currentDiagram.name}`
                : diagramName || t('status.untitled')}
              {hasUnsavedChanges && (
                <Text as="span" sx={{ color: 'attention.fg', marginLeft: '8px' }}>
                  • {t('status.modified')}
                </Text>
              )}
            </>
          )}
        </Text>

        <ChangeLanguage />
      </header>

      <div className="fossflow-container">
        <Isoflow
          key={`${fossflowKey}-${i18n.language}`}
          initialData={diagramData}
          onModelUpdated={handleModelUpdated}
          editorMode={isReadonlyUrl ? 'EXPLORABLE_READONLY' : 'EDITABLE'}
          locale={currentLocale}
          iconPackManager={{
            lazyLoadingEnabled: iconPackManager.lazyLoadingEnabled,
            onToggleLazyLoading: iconPackManager.toggleLazyLoading,
            packInfo: Object.values(iconPackManager.packInfo),
            enabledPacks: iconPackManager.enabledPacks,
            onTogglePack: (packName: string, enabled: boolean) => {
              iconPackManager.togglePack(packName as any, enabled);
            }
          }}
        />
      </div>

      {/* Save Dialog */}
      {showSaveDialog && (
        <div className="fossflow-modal-overlay">
          <div className="fossflow-modal" style={{ width: '480px' }}>
            <div className="fossflow-modal-header">
              <Heading as="h2" sx={{ fontSize: 2 }}>{t('dialog.save.title')}</Heading>
            </div>
            <div className="fossflow-modal-body">
              <Flash variant="warning" sx={{ mb: 3, fontSize: 1 }}>
                <Text sx={{ fontWeight: 'semibold' }}>⚠️ {t('dialog.save.warningTitle')}:</Text>{' '}
                {t('dialog.save.warningMessage')}
              </Flash>
              <FormControl>
                <FormControl.Label>{t('dialog.save.placeholder')}</FormControl.Label>
                <TextInput
                  block
                  placeholder={t('dialog.save.placeholder')}
                  value={diagramName}
                  onChange={(e) => setDiagramName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && saveDiagram()}
                  autoFocus
                />
              </FormControl>
            </div>
            <div className="fossflow-modal-footer">
              <div style={{ flexGrow: 1 }} />
              <Button onClick={() => setShowSaveDialog(false)}>{t('dialog.save.btnCancel')}</Button>
              <Button variant="primary" onClick={saveDiagram}>{t('dialog.save.btnSave')}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Load Dialog */}
      {showLoadDialog && (
        <div className="fossflow-modal-overlay">
          <div className="fossflow-modal" style={{ width: '540px', maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div className="fossflow-modal-header">
              <Heading as="h2" sx={{ fontSize: 2 }}>{t('dialog.load.title')}</Heading>
            </div>
            <div className="fossflow-modal-body" style={{ flex: 1, overflow: 'auto' }}>
              <Flash variant="warning" sx={{ mb: 3, fontSize: 1 }}>
                <Text sx={{ fontWeight: 'semibold' }}>⚠️ {t('dialog.load.noteTitle')}:</Text>{' '}
                {t('dialog.load.noteMessage')}
              </Flash>
              {diagrams.length === 0 ? (
                <Text sx={{ color: 'fg.muted' }}>{t('dialog.load.noSavedDiagrams')}</Text>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {diagrams.map((diagram) => (
                    <div key={diagram.id} className="fossflow-diagram-item">
                      <div>
                        <Text sx={{ fontWeight: 'semibold', display: 'block' }}>{diagram.name}</Text>
                        <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
                          {t('dialog.load.updated')}: {new Date(diagram.updatedAt).toLocaleString()}
                        </Text>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <Button size="small" variant="primary" onClick={() => loadDiagram(diagram, false)}>
                          {t('dialog.load.btnLoad')}
                        </Button>
                        <Button size="small" variant="danger" onClick={() => deleteDiagram(diagram.id)}>
                          {t('dialog.load.btnDelete')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="fossflow-modal-footer">
              <div style={{ flexGrow: 1 }} />
              <Button onClick={() => setShowLoadDialog(false)}>{t('dialog.load.btnClose')}</Button>
            </div>
          </div>
        </div>
      )}

      {/* Export Dialog */}
      {showExportDialog && (
        <div className="fossflow-modal-overlay">
          <div className="fossflow-modal" style={{ width: '480px' }}>
            <div className="fossflow-modal-header">
              <Heading as="h2" sx={{ fontSize: 2 }}>{t('dialog.export.title')}</Heading>
            </div>
            <div className="fossflow-modal-body">
              <Flash variant="success" sx={{ mb: 3 }}>
                <Text sx={{ fontWeight: 'semibold' }}>✅ {t('dialog.export.recommendedTitle')}:</Text>{' '}
                {t('dialog.export.recommendedMessage')}
              </Flash>
              <Text sx={{ fontSize: 1, color: 'fg.muted' }}>{t('dialog.export.noteMessage')}</Text>
            </div>
            <div className="fossflow-modal-footer">
              <div style={{ flexGrow: 1 }} />
              <Button onClick={() => setShowExportDialog(false)}>{t('dialog.export.btnCancel')}</Button>
              <Button variant="primary" leadingVisual={DownloadIcon} onClick={exportDiagram}>
                {t('dialog.export.btnDownload')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Storage Manager */}
      {showStorageManager && (
        <StorageManager
          onClose={() => setShowStorageManager(false)}
        />
      )}

      {/* Diagram Manager */}
      {showDiagramManager && (
        <DiagramManager
          onLoadDiagram={handleDiagramManagerLoad}
          currentDiagramId={currentDiagram?.id}
          currentDiagramData={currentModel || diagramData}
          onClose={() => setShowDiagramManager(false)}
        />
      )}

      {/* Bedrock Settings */}
      {showBedrockSettings && (
        <BedrockSettings onClose={() => setShowBedrockSettings(false)} />
      )}

      {/* AI Generate Dialog */}
      {showAiGenerate && (
        <AiGenerateDialog
          onClose={() => setShowAiGenerate(false)}
          onDiagramGenerated={(generated) => {
            const mergedData = mergeDiagramData(diagramData, generated);
            setDiagramData(mergedData);
            setCurrentModel(mergedData);
            setHasUnsavedChanges(true);
            setFossflowKey((k) => k + 1);
          }}
          currentDiagramData={currentModel || diagramData}
        />
      )}
    </div>
  );
}

export default App;
