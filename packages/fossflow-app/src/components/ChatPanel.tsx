import { useState, useRef, useEffect, useCallback } from 'react';
import './ChatPanel.css';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  hasDiagramUpdate?: boolean;
}

interface ChatPanelProps {
  diagramData: any;
  onDiagramUpdate: (diagram: any) => void;
  isReadonly?: boolean;
}

const BACKEND_URL =
  window.location.hostname === 'localhost' && window.location.port === '3000'
    ? 'http://localhost:3001'
    : '';

const SUGGESTIONS = [
  '🏗️ Create a microservices architecture for an e-commerce platform',
  '☁️ Design an AWS cloud infrastructure with load balancing',
  '🔐 Draw an authentication and authorization flow',
  '📊 Build a data pipeline from ingestion to analytics',
];

export function ChatPanel({ diagramData, onDiagramUpdate, isReadonly }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isOnline, setIsOnline] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Check if backend AI is available
  useEffect(() => {
    fetch(`${BACKEND_URL}/api/storage/status`, { signal: AbortSignal.timeout(3000) })
      .then(() => setIsOnline(true))
      .catch(() => setIsOnline(false));
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  const handleTextareaInput = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  };

  const addMessage = useCallback((role: 'user' | 'assistant', content: string, hasDiagramUpdate = false): string => {
    const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setMessages(prev => [
      ...prev,
      { id, role, content, timestamp: new Date(), hasDiagramUpdate }
    ]);
    return id;
  }, []);

  const updateLastAssistantMessage = useCallback((id: string, content: string, hasDiagramUpdate?: boolean) => {
    setMessages(prev =>
      prev.map(msg =>
        msg.id === id
          ? { ...msg, content, ...(hasDiagramUpdate !== undefined ? { hasDiagramUpdate } : {}) }
          : msg
      )
    );
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming) return;

    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Add user message
    addMessage('user', text.trim());

    // Build conversation history for API
    const history = messages.map(m => ({ role: m.role, content: m.content }));
    history.push({ role: 'user', content: text.trim() });

    // Add assistant placeholder
    const assistantMsgId = addMessage('assistant', '');

    setIsStreaming(true);
    abortControllerRef.current = new AbortController();

    let assistantText = '';
    let hasDiagramUpdate = false;

    try {
      const response = await fetch(`${BACKEND_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          diagramData: diagramData
        }),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Request failed' }));
        throw new Error(err.error || `HTTP ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i].trim();
          if (!line) continue;

          if (line.startsWith('event: ')) {
            const eventType = line.slice(7);
            const dataLine = lines[i + 1];
            if (dataLine?.startsWith('data: ')) {
              i++; // skip data line in outer loop
              try {
                const data = JSON.parse(dataLine.slice(6));

                if (eventType === 'delta') {
                  assistantText += data.text || '';
                  updateLastAssistantMessage(assistantMsgId, assistantText);
                } else if (eventType === 'diagram_update') {
                  hasDiagramUpdate = true;
                  onDiagramUpdate(data.diagram);
                  updateLastAssistantMessage(assistantMsgId, assistantText, true);
                } else if (eventType === 'error') {
                  assistantText += `\n\n⚠️ Error: ${data.message}`;
                  updateLastAssistantMessage(assistantMsgId, assistantText);
                }
              } catch {
                // ignore parse errors
              }
            }
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        assistantText += '\n\n_Stopped._';
      } else {
        const errMsg = err.message || 'Unknown error';
        assistantText = `⚠️ **Connection error**: ${errMsg}\n\nMake sure the backend server is running and AWS credentials are configured.`;
      }
      updateLastAssistantMessage(assistantMsgId, assistantText, hasDiagramUpdate);
    } finally {
      setIsStreaming(false);
      abortControllerRef.current = null;
    }
  }, [messages, diagramData, isStreaming, addMessage, updateLastAssistantMessage, onDiagramUpdate]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const handleStop = () => {
    abortControllerRef.current?.abort();
  };

  const formatTime = (date: Date) =>
    date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  if (isReadonly) return null;

  return (
    <div
      className={`chat-panel${isCollapsed ? ' chat-panel-collapsed' : ''}`}
      style={{ width: isCollapsed ? '0px' : '340px', minWidth: isCollapsed ? '0' : '280px' }}
    >
      {isCollapsed ? (
        <button
          className="chat-collapsed-btn"
          onClick={() => setIsCollapsed(false)}
          title="Open AI Chat"
        >
          <span style={{ fontSize: '18px' }}>🤖</span>
          <span className="chat-collapsed-label">AI Chat</span>
        </button>
      ) : (
        <>
          {/* Header */}
          <div className="chat-header">
            <div className="chat-header-logo">🤖</div>
            <div className="chat-header-info">
              <div className="chat-header-title">Claude Assistant</div>
              <div className="chat-header-subtitle">Powered by Amazon Bedrock</div>
            </div>
            <div className="chat-header-status">
              <span
                className={`status-dot ${isStreaming ? 'thinking' : isOnline ? 'online' : ''}`}
              />
              <span>{isStreaming ? 'Thinking…' : isOnline ? 'Ready' : 'Offline'}</span>
            </div>
            <button
              className="chat-toggle-btn"
              onClick={() => setIsCollapsed(true)}
              title="Collapse chat"
              style={{ position: 'static', transform: 'none', marginLeft: '4px' }}
            >
              ‹
            </button>
          </div>

          {/* Messages */}
          <div className="chat-messages">
            {messages.length === 0 ? (
              <div className="chat-welcome">
                <div className="chat-welcome-icon">✨</div>
                <h3>Design with AI</h3>
                <p>
                  Describe the architecture you want to create and Claude will
                  build it for you instantly.
                </p>
                <div className="chat-welcome-suggestions">
                  {SUGGESTIONS.map(s => (
                    <button
                      key={s}
                      className="suggestion-chip"
                      onClick={() => sendMessage(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map(msg => (
                  <div key={msg.id} className={`chat-message ${msg.role}`}>
                    <div className="message-avatar">
                      {msg.role === 'assistant' ? '🤖' : '👤'}
                    </div>
                    <div className="message-content">
                      <div className="message-bubble">
                        {msg.content || (
                          isStreaming && msg.role === 'assistant' ? (
                            <div className="thinking-bubble" style={{ background: 'none', border: 'none', padding: 0 }}>
                              <div className="thinking-dot" />
                              <div className="thinking-dot" />
                              <div className="thinking-dot" />
                            </div>
                          ) : null
                        )}
                      </div>
                      {msg.hasDiagramUpdate && (
                        <div className="diagram-update-notice">
                          ✅ Diagram updated
                        </div>
                      )}
                      <div className="message-time">{formatTime(msg.timestamp)}</div>
                    </div>
                  </div>
                ))}
              </>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div className="chat-input-area">
            <div className="chat-input-wrapper">
              <textarea
                ref={textareaRef}
                className="chat-textarea"
                placeholder="Describe the diagram you want to create…"
                value={input}
                onChange={e => setInput(e.target.value)}
                onInput={handleTextareaInput}
                onKeyDown={handleKeyDown}
                disabled={isStreaming}
                rows={1}
              />
              {isStreaming ? (
                <button className="chat-send-btn" onClick={handleStop} title="Stop">
                  ⏹
                </button>
              ) : (
                <button
                  className="chat-send-btn"
                  onClick={() => sendMessage(input)}
                  disabled={!input.trim()}
                  title="Send (Enter)"
                >
                  ➤
                </button>
              )}
            </div>
            <div className="chat-input-hint">Enter to send · Shift+Enter for new line</div>
          </div>
        </>
      )}
    </div>
  );
}
