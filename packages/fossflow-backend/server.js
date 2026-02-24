import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  BedrockRuntimeClient,
  InvokeModelCommand
} from '@aws-sdk/client-bedrock-runtime';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.BACKEND_PORT || 3001;

// Configuration from environment variables
const STORAGE_ENABLED = process.env.ENABLE_SERVER_STORAGE === 'true';
const STORAGE_PATH = process.env.STORAGE_PATH || '/data/diagrams';
const ENABLE_GIT_BACKUP = process.env.ENABLE_GIT_BACKUP === 'true';

// Simple in-memory rate limiter for the Bedrock endpoint (max 10 req/min per IP)
const bedrockRateLimitMap = new Map();
const BEDROCK_RATE_LIMIT = 10;
const BEDROCK_RATE_WINDOW_MS = 60_000;

function bedrockRateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = bedrockRateLimitMap.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > BEDROCK_RATE_WINDOW_MS) {
    entry.count = 1;
    entry.windowStart = now;
  } else {
    entry.count += 1;
  }

  bedrockRateLimitMap.set(ip, entry);

  if (entry.count > BEDROCK_RATE_LIMIT) {
    return res.status(429).json({ error: 'Too many requests. Please wait before trying again.' });
  }
  next();
}

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check / Storage status endpoint
app.get('/api/storage/status', (req, res) => {
  res.json({
    enabled: STORAGE_ENABLED,
    gitBackup: ENABLE_GIT_BACKUP,
    version: '1.0.0'
  });
});

// Only enable storage endpoints if storage is enabled
if (STORAGE_ENABLED) {
  // Ensure storage directory exists
  async function ensureStorageDir() {
    try {
      await fs.access(STORAGE_PATH);
      console.log(`Storage directory exists: ${STORAGE_PATH}`);

      // Log current files
      const files = await fs.readdir(STORAGE_PATH);
      console.log(`Current files in storage: ${files.length} files`);
      if (files.length > 0) {
        console.log('Files:', files.join(', '));
      }
    } catch {
      console.log(`Creating storage directory: ${STORAGE_PATH}`);
      await fs.mkdir(STORAGE_PATH, { recursive: true });
      console.log(`Created storage directory: ${STORAGE_PATH}`);
    }
  }

  // Initialize storage
  ensureStorageDir().catch((err) => {
    console.error('Failed to initialize storage:', err);
  });

  // List all diagrams
  app.get('/api/diagrams', async (req, res) => {
    try {
      // First check if storage directory exists
      try {
        await fs.access(STORAGE_PATH);
      } catch (err) {
        console.error(`Storage directory does not exist: ${STORAGE_PATH}`);
        return res.json([]); // Return empty array if directory doesn't exist
      }

      const files = await fs.readdir(STORAGE_PATH);
      console.log(`Found ${files.length} files in ${STORAGE_PATH}:`, files);
      const diagrams = [];

      for (const file of files) {
        if (file.endsWith('.json') && file !== 'metadata.json') {
          try {
            const filePath = path.join(STORAGE_PATH, file);
            const stats = await fs.stat(filePath);
            const content = await fs.readFile(filePath, 'utf-8');
            const data = JSON.parse(content);

            // Extract name from various possible locations
            const name = data.name || data.title || 'Untitled Diagram';

            console.log(`Successfully read diagram: ${file} (name: ${name})`);

            diagrams.push({
              id: file.replace('.json', ''),
              name: name,
              lastModified: stats.mtime,
              size: stats.size
            });
          } catch (fileError) {
            console.error(`Error reading diagram file ${file}:`, fileError.message);
            // Skip this file and continue with others
            continue;
          }
        }
      }

      console.log(`Returning ${diagrams.length} diagrams`);
      res.json(diagrams);
    } catch (error) {
      console.error('Error listing diagrams:', error);
      res.status(500).json({ error: 'Failed to list diagrams', details: error.message });
    }
  });

  // Get specific diagram
  app.get('/api/diagrams/:id', async (req, res) => {
    const diagramId = req.params.id;
    console.log(`[GET /api/diagrams/${diagramId}] Loading diagram...`);

    try {
      const filePath = path.join(STORAGE_PATH, `${diagramId}.json`);
      console.log(`[GET /api/diagrams/${diagramId}] Reading from: ${filePath}`);

      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);

      console.log(`[GET /api/diagrams/${diagramId}] Successfully loaded, size: ${content.length} bytes, items: ${data.items?.length || 0}`);
      res.json(data);
    } catch (error) {
      if (error.code === 'ENOENT') {
        console.error(`[GET /api/diagrams/${diagramId}] Diagram not found`);
        res.status(404).json({ error: 'Diagram not found' });
      } else {
        console.error(`[GET /api/diagrams/${diagramId}] Error reading diagram:`, error);
        res.status(500).json({ error: 'Failed to read diagram' });
      }
    }
  });

  // Save or update diagram
  app.put('/api/diagrams/:id', async (req, res) => {
    const diagramId = req.params.id;
    console.log(`[PUT /api/diagrams/${diagramId}] Saving diagram...`);

    try {
      const filePath = path.join(STORAGE_PATH, `${diagramId}.json`);
      const data = {
        ...req.body,
        id: diagramId,
        lastModified: new Date().toISOString()
      };

      const iconCount = data.icons?.length || 0;
      const importedIconCount = (data.icons || []).filter(icon => icon.collection === 'imported').length;
      console.log(`[PUT /api/diagrams/${diagramId}] Writing to: ${filePath}`);
      console.log(`[PUT /api/diagrams/${diagramId}]   Items: ${data.items?.length || 0}, Icons: ${iconCount} (${importedIconCount} imported)`);

      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      console.log(`[PUT /api/diagrams/${diagramId}] Successfully saved`);

      // Git backup if enabled
      if (ENABLE_GIT_BACKUP) {
        // TODO: Implement git commit
        console.log('[PUT] Git backup not yet implemented');
      }

      res.json({ success: true, id: diagramId });
    } catch (error) {
      console.error(`[PUT /api/diagrams/${diagramId}] Error saving diagram:`, error);
      res.status(500).json({ error: 'Failed to save diagram' });
    }
  });

  // Delete diagram
  app.delete('/api/diagrams/:id', async (req, res) => {
    try {
      const filePath = path.join(STORAGE_PATH, `${req.params.id}.json`);
      await fs.unlink(filePath);
      
      res.json({ success: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        res.status(404).json({ error: 'Diagram not found' });
      } else {
        console.error('Error deleting diagram:', error);
        res.status(500).json({ error: 'Failed to delete diagram' });
      }
    }
  });

  // Create a new diagram
  app.post('/api/diagrams', async (req, res) => {
    try {
      const id = req.body.id || `diagram_${Date.now()}`;
      const filePath = path.join(STORAGE_PATH, `${id}.json`);
      
      // Check if already exists
      try {
        await fs.access(filePath);
        return res.status(409).json({ error: 'Diagram already exists' });
      } catch {
        // File doesn't exist, proceed
      }
      
      const data = {
        ...req.body,
        id,
        created: new Date().toISOString(),
        lastModified: new Date().toISOString()
      };
      
      await fs.writeFile(filePath, JSON.stringify(data, null, 2));
      res.status(201).json({ success: true, id });
    } catch (error) {
      console.error('Error creating diagram:', error);
      res.status(500).json({ error: 'Failed to create diagram' });
    }
  });

} else {
  // Storage disabled - return appropriate responses
  app.get('/api/diagrams', (req, res) => {
    res.status(503).json({ error: 'Server storage is disabled' });
  });
  
  app.get('/api/diagrams/:id', (req, res) => {
    res.status(503).json({ error: 'Server storage is disabled' });
  });
  
  app.put('/api/diagrams/:id', (req, res) => {
    res.status(503).json({ error: 'Server storage is disabled' });
  });
  
  app.delete('/api/diagrams/:id', (req, res) => {
    res.status(503).json({ error: 'Server storage is disabled' });
  });
  
  app.post('/api/diagrams', (req, res) => {
    res.status(503).json({ error: 'Server storage is disabled' });
  });
}

// ─── Amazon Bedrock / Claude AI Endpoint ────────────────────────────────────
// Accepts caller-supplied credentials so the server doesn't need its own keys.
// Credentials are validated and forwarded to AWS; they are never persisted.
app.post('/api/bedrock/generate', bedrockRateLimit, async (req, res) => {
  const { prompt, currentDiagram, credentials } = req.body;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt is required' });
  }

  const { accessKeyId, secretAccessKey, region, modelId } = credentials || {};
  if (!accessKeyId || !secretAccessKey || !region || !modelId) {
    return res.status(400).json({
      error: 'AWS credentials (accessKeyId, secretAccessKey, region, modelId) are required'
    });
  }

  try {
    const client = new BedrockRuntimeClient({
      region,
      credentials: { accessKeyId, secretAccessKey }
    });

    const systemPrompt = `You are a diagram generation assistant for FossFLOW, an isometric network/infrastructure diagram editor.
Your job is to produce valid JSON that describes diagram items for the Isoflow diagram format.

The output must be a valid JSON object with this structure:
{
  "items": [
    {
      "id": "<unique-string>",
      "type": "NODE",
      "label": "<display label>",
      "position": { "x": <number>, "y": <number> }
    }
  ],
  "connectors": [
    {
      "id": "<unique-string>",
      "from": "<item-id>",
      "to": "<item-id>",
      "label": "<optional label>"
    }
  ]
}

Rules:
- Use type "NODE" for all diagram items
- Position values should be integers between 0 and 20, spaced 3-4 units apart
- Use short, clear labels (max 3 words)
- Return ONLY the JSON object, no markdown, no explanation
- If the user mentions updating/modifying the current diagram, incorporate the existing items and add/modify as instructed`;

    const userMessage = currentDiagram?.items?.length
      ? `Current diagram has ${currentDiagram.items.length} items. ${prompt}`
      : prompt;

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    };

    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload)
    });

    const response = await client.send(command);
    const responseText = new TextDecoder().decode(response.body);
    const responseData = JSON.parse(responseText);

    const content = responseData.content?.[0]?.text || '';

    // Extract JSON from the response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'AI did not return valid diagram JSON', raw: content });
    }

    const diagramData = JSON.parse(jsonMatch[0]);

    // Merge with current diagram if provided
    if (currentDiagram && currentDiagram.items?.length) {
      const existingIds = new Set((currentDiagram.items || []).map((i) => i.id));
      const newItems = (diagramData.items || []).filter((i) => !existingIds.has(i.id));
      diagramData.items = [...(currentDiagram.items || []), ...newItems];
    }

    res.json(diagramData);
  } catch (error) {
    console.error('Bedrock error:', error?.name, error?.message);
    // Return a generic error to avoid leaking AWS internals or credential details
    const isCredentialError =
      error?.name === 'CredentialsProviderError' ||
      error?.name === 'InvalidSignatureException' ||
      error?.name === 'UnrecognizedClientException' ||
      error?.name === 'AccessDeniedException';
    const isModelError =
      error?.name === 'ResourceNotFoundException' ||
      error?.name === 'ValidationException';

    let userMessage = 'Failed to call Amazon Bedrock';
    if (isCredentialError) userMessage = 'Invalid AWS credentials. Please check your Access Key and Secret Key.';
    else if (isModelError) userMessage = 'Model not found or not enabled. Please verify the model ID in your AWS Bedrock console.';

    res.status(500).json({ error: userMessage });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`FossFLOW Backend Server running on port ${PORT}`);
  console.log(`Server storage: ${STORAGE_ENABLED ? 'ENABLED' : 'DISABLED'}`);
  if (STORAGE_ENABLED) {
    console.log(`Storage path: ${STORAGE_PATH}`);
    console.log(`Git backup: ${ENABLE_GIT_BACKUP ? 'ENABLED' : 'DISABLED'}`);
  }
});