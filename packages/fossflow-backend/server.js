import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { BedrockRuntimeClient, ConverseStreamCommand } from '@aws-sdk/client-bedrock-runtime';

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

// AWS Bedrock Configuration
const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const BEDROCK_MODEL_ID = process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-opus-4-5-20241022-v1:0';

// Initialize Bedrock client (uses AWS credentials from environment or instance profile)
const bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });

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

// AI Chat endpoint - streaming SSE with Claude via Bedrock
app.post('/api/ai/chat', async (req, res) => {
  const { messages, diagramData } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const sendEvent = (type, data) => {
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Build system prompt with diagram context
    const systemPrompt = `You are an expert diagram architect assistant integrated into FossFLOW, an isometric diagram editor. You help users create, modify, and understand architecture diagrams through natural conversation.

When a user asks you to create or modify a diagram, you should respond with a JSON diagram update using the tool "update_diagram".

The diagram data format is:
{
  "title": "string - diagram title",
  "items": [
    {
      "id": "unique_string_id",
      "type": "isoflow__<icon_type>",
      "name": "Display Name",
      "description": "Optional description",
      "position": { "x": number, "y": number }
    }
  ],
  "connectors": [
    {
      "id": "unique_connector_id",
      "from": "source_item_id",
      "to": "target_item_id",
      "name": "Connection label",
      "color": "blue|green|red|orange|purple|black|gray"
    }
  ],
  "colors": [
    { "id": "blue", "value": "#0066cc" },
    { "id": "green", "value": "#00aa00" },
    { "id": "red", "value": "#cc0000" },
    { "id": "orange", "value": "#ff9900" },
    { "id": "purple", "value": "#9900cc" }
  ]
}

Available icon types (use as "type" field with "isoflow__" prefix):
- person, web_app, api, microservice, database, load_balancer, cache, queue
- server, storage, network, firewall, cloud, container, kubernetes
- redis, postgresql, mysql, mongodb, elasticsearch
- authentication, monitoring, notification, analytics, backup, logs
- mobile_app, desktop_app, browser, cdn, dns, vpn, gateway

Position items in a logical layout:
- Use x: 50-1000, y: 50-600 range
- Space items 150 units apart horizontally, 100 units vertically
- Group related services together

Current diagram state:
${diagramData ? JSON.stringify(diagramData, null, 2) : 'Empty diagram - no items yet'}

Be conversational, helpful, and explain what you're creating. When you update a diagram, briefly describe the architecture decisions you made.`;

    // Convert messages to Bedrock format
    const bedrockMessages = messages.map(msg => ({
      role: msg.role,
      content: [{ type: 'text', text: msg.content }]
    }));

    // Tool definition for diagram updates
    const tools = [
      {
        toolSpec: {
          name: 'update_diagram',
          description: 'Update the diagram with new items, connectors, and layout. Call this whenever the user asks to create or modify the diagram.',
          inputSchema: {
            json: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'The diagram title' },
                items: {
                  type: 'array',
                  description: 'Array of diagram items (nodes)',
                  items: {
                    type: 'object',
                    required: ['id', 'type', 'name', 'position'],
                    properties: {
                      id: { type: 'string' },
                      type: { type: 'string' },
                      name: { type: 'string' },
                      description: { type: 'string' },
                      position: {
                        type: 'object',
                        properties: {
                          x: { type: 'number' },
                          y: { type: 'number' }
                        },
                        required: ['x', 'y']
                      }
                    }
                  }
                },
                connectors: {
                  type: 'array',
                  description: 'Array of connections between items',
                  items: {
                    type: 'object',
                    required: ['id', 'from', 'to'],
                    properties: {
                      id: { type: 'string' },
                      from: { type: 'string' },
                      to: { type: 'string' },
                      name: { type: 'string' },
                      color: { type: 'string' }
                    }
                  }
                },
                colors: {
                  type: 'array',
                  description: 'Color palette for the diagram',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string' },
                      value: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    ];

    let continueLoop = true;
    let loopMessages = [...bedrockMessages];
    let iterationCount = 0;
    const MAX_ITERATIONS = 5;

    while (continueLoop && iterationCount < MAX_ITERATIONS) {
      iterationCount++;

      const command = new ConverseStreamCommand({
        modelId: BEDROCK_MODEL_ID,
        system: [{ text: systemPrompt }],
        messages: loopMessages,
        toolConfig: { tools },
        inferenceConfig: {
          maxTokens: 8192,
          temperature: 0.7
        }
      });

      const response = await bedrockClient.send(command);
      const stream = response.stream;

      let fullText = '';
      let toolUseId = null;
      let toolName = null;
      let toolInputJson = '';
      let stopReason = null;
      const assistantContent = [];

      for await (const chunk of stream) {
        if (chunk.contentBlockStart) {
          const block = chunk.contentBlockStart.start;
          if (block?.toolUse) {
            toolUseId = block.toolUse.toolUseId;
            toolName = block.toolUse.name;
            toolInputJson = '';
          }
        } else if (chunk.contentBlockDelta) {
          const delta = chunk.contentBlockDelta.delta;
          if (delta?.text) {
            fullText += delta.text;
            sendEvent('delta', { text: delta.text });
          } else if (delta?.toolUse?.input) {
            toolInputJson += delta.toolUse.input;
          }
        } else if (chunk.contentBlockStop) {
          if (toolUseId && toolName) {
            let toolInput = {};
            try {
              toolInput = JSON.parse(toolInputJson);
            } catch (e) {
              console.error('Failed to parse tool input:', e);
            }
            assistantContent.push({
              toolUse: { toolUseId, name: toolName, input: toolInput }
            });

            if (toolName === 'update_diagram') {
              sendEvent('diagram_update', { diagram: toolInput });
            }

            toolUseId = null;
            toolName = null;
            toolInputJson = '';
          } else if (fullText) {
            assistantContent.push({ text: fullText });
            fullText = '';
          }
        } else if (chunk.messageStop) {
          stopReason = chunk.messageStop.stopReason;
        }
      }

      // Add assistant message to loop
      if (assistantContent.length > 0) {
        loopMessages.push({ role: 'assistant', content: assistantContent });
      }

      // Handle tool use - provide results and continue
      if (stopReason === 'tool_use') {
        const toolResults = assistantContent
          .filter(block => block.toolUse)
          .map(block => ({
            toolResult: {
              toolUseId: block.toolUse.toolUseId,
              content: [{ text: 'Diagram updated successfully.' }]
            }
          }));

        if (toolResults.length > 0) {
          loopMessages.push({ role: 'user', content: toolResults });
        }
      } else {
        continueLoop = false;
      }
    }

    sendEvent('done', { finished: true });
    res.end();
  } catch (error) {
    console.error('AI chat error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'AI chat failed', details: error.message });
    } else {
      sendEvent('error', { message: error.message });
      res.end();
    }
  }
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

// Start server
app.listen(PORT, () => {
  console.log(`FossFLOW Backend Server running on port ${PORT}`);
  console.log(`Server storage: ${STORAGE_ENABLED ? 'ENABLED' : 'DISABLED'}`);
  if (STORAGE_ENABLED) {
    console.log(`Storage path: ${STORAGE_PATH}`);
    console.log(`Git backup: ${ENABLE_GIT_BACKUP ? 'ENABLED' : 'DISABLED'}`);
  }
});