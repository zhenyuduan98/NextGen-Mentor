"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  role: "user" | "assistant";
  content: string;
  sources?: { title: string; content: string; chunk_index: number; score: number }[];
}

interface SourceItem {
  title: string;
  content: string;
  chunk_index: number;
  score: number;
}

interface Session {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [referencePanel, setReferencePanel] = useState<SourceItem | null>(null);
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [memoryData, setMemoryData] = useState<{ context: any[]; skills: any[] }>({ context: [], skills: [] });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auth state
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [authError, setAuthError] = useState("");

  const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const saved = localStorage.getItem("token");
    if (saved) setToken(saved);
  }, []);

  useEffect(() => {
    if (token) {
      fetchSessions();
      fetchMemory();
    }
  }, [token]);

  const fetchMemory = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/memory`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setMemoryData({ context: data.context || [], skills: data.skills || [] });
      }
    } catch {}
  };

  const summarizeSkills = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/memory/summarize`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.skills) {
          setMemoryData((prev) => ({ ...prev, skills: data.skills }));
        }
      }
    } catch {}
  };

  const fetchSessions = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSessions(data);
      }
    } catch {}
  };

  const loadSession = async (sid: string) => {
    if (!token) return;
    try {
      const res = await fetch(`${API_BASE}/api/chat/sessions/${sid}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setSessionId(sid);
        setMessages(
          data.messages.map((m: any) => ({
            role: m.role,
            content: m.content,
            sources: m.sources?.map((s: any) =>
              typeof s === 'string' ? { title: s, content: '', chunk_index: 0, score: 0 } : s
            ),
          }))
        );
      }
    } catch {}
  };

  const newChat = () => {
    setSessionId(null);
    setMessages([]);
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const body =
      authMode === "login"
        ? { email, password }
        : { email, password, display_name: displayName };

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json();
        setAuthError(err.detail || "Authentication failed");
        return;
      }
      const data = await res.json();
      setToken(data.access_token);
      localStorage.setItem("token", data.access_token);
    } catch {
      setAuthError("Network error");
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !token) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setIsLoading(true);

    try {
      const res = await fetch(`${API_BASE}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ message: userMessage, session_id: sessionId }),
      });

      if (!res.ok) {
        if (res.status === 401) {
          setToken(null);
          localStorage.removeItem("token");
          return;
        }
        throw new Error("Chat request failed");
      }

      const newSessionId = res.headers.get("X-Session-Id");
      if (newSessionId) setSessionId(newSessionId);

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantContent = "";

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              fetchSessions();
              fetchMemory();
              break;
            }
            if (data.startsWith("[SOURCES]")) {
              try {
                const sourcesData = JSON.parse(data.slice(9));
                setMessages((prev) => {
                  const updated = [...prev];
                  updated[updated.length - 1] = {
                    ...updated[updated.length - 1],
                    sources: sourcesData,
                  };
                  return updated;
                });
              } catch {}
              continue;
            }
            assistantContent += data;
            setMessages((prev) => {
              const updated = [...prev];
              updated[updated.length - 1] = {
                role: "assistant",
                content: assistantContent,
              };
              return updated;
            });
          }
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ 请求失败，请重试" },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  // ===== AUTH SCREEN (Microsoft Azure Style) =====
  if (!token) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0078d4] via-[#005a9e] to-[#003d6b]">
        <div className="w-full max-w-[440px] rounded-md bg-white p-10 shadow-2xl">
          {/* Microsoft logo */}
          <div className="mb-8">
            <div className="mb-4 flex items-center gap-2">
              {/* Microsoft 4-square logo */}
              <div className="grid grid-cols-2 gap-0.5 h-5 w-5">
                <div className="bg-[#f25022]"></div>
                <div className="bg-[#7fba00]"></div>
                <div className="bg-[#00a4ef]"></div>
                <div className="bg-[#ffb900]"></div>
              </div>
              <span className="text-lg font-semibold text-gray-800">Microsoft</span>
            </div>
            <h1 className="text-2xl font-semibold text-gray-900">
              {authMode === "login" ? "Sign in" : "Create account"}
            </h1>
            <p className="mt-1 text-sm text-gray-600">
              to access NextGen Mentor
            </p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            {authMode === "register" && (
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full border-b-2 border-gray-300 px-1 py-2.5 text-base outline-none transition focus:border-[#0078d4]"
                placeholder="Display name"
                required
              />
            )}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border-b-2 border-gray-300 px-1 py-2.5 text-base outline-none transition focus:border-[#0078d4]"
              placeholder="Email"
              required
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border-b-2 border-gray-300 px-1 py-2.5 text-base outline-none transition focus:border-[#0078d4]"
              placeholder="Password"
              required
            />

            {authError && (
              <p className="text-sm text-red-600">{authError}</p>
            )}

            <div className="pt-4">
              <button
                type="submit"
                className="w-full rounded-sm bg-[#0078d4] py-2.5 text-sm font-semibold text-white transition hover:bg-[#106ebe]"
              >
                {authMode === "login" ? "Sign in" : "Create account"}
              </button>
            </div>

            <div className="pt-2 text-center">
              <button
                type="button"
                onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
                className="text-sm text-[#0078d4] hover:underline"
              >
                {authMode === "login" ? "No account? Create one!" : "Already have an account? Sign in"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ===== CHAT SCREEN (Azure Style with Sidebar) =====
  return (
    <div className="flex h-screen bg-[#f3f2f1]">
      {/* Sidebar */}
      <aside
        className={`${
          sidebarOpen ? "w-72" : "w-0"
        } flex flex-col border-r border-gray-200 bg-white transition-all duration-200 overflow-hidden`}
      >
        {/* Header with Azure branding */}
        <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3 bg-[#0078d4]">
          <img src="/azure-logo.png" className="h-5 w-5 rounded" alt="Azure" />
          <span className="text-sm font-semibold text-white">NextGen Mentor</span>
        </div>

        {/* New Chat Button */}
        <div className="p-3">
          <button
            onClick={newChat}
            className="flex w-full items-center gap-2 rounded px-4 py-2.5 text-sm font-medium text-[#0078d4] border border-[#0078d4] transition hover:bg-[#0078d4]/5"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            New conversation
          </button>
        </div>

        {/* Session List */}
        <div className="flex-1 overflow-y-auto px-2">
          <p className="mb-1.5 px-2 pt-2 text-xs font-semibold text-gray-500 uppercase tracking-wide">History</p>
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => loadSession(s.id)}
              className={`mb-0.5 w-full rounded px-3 py-2 text-left text-sm transition hover:bg-[#edebe9] ${
                sessionId === s.id ? "bg-[#deecf9] text-[#0078d4] font-medium border-l-2 border-[#0078d4]" : "text-gray-700"
              }`}
            >
              <p className="truncate">{s.title}</p>
            </button>
          ))}
          {sessions.length === 0 && (
            <p className="px-3 py-2 text-sm text-gray-400">No conversations yet</p>
          )}
        </div>

        {/* Memory & Skills Panel */}
        <div className="border-t border-gray-200">
          <button
            onClick={() => setMemoryOpen(!memoryOpen)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-[#edebe9] transition"
          >
            <span className="flex items-center gap-2">
              <span>🧠</span>
              <span>Memory & Skills</span>
            </span>
            <svg className={`h-4 w-4 text-gray-400 transition ${memoryOpen ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
              <path d="M19 9l-7 7-7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {memoryOpen && (
            <div className="max-h-64 overflow-y-auto px-3 pb-3">
              {/* Skills */}
              {memoryData.skills.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1.5 text-xs font-semibold text-gray-500 uppercase">Skills</p>
                  <div className="space-y-1">
                    {memoryData.skills.map((s: any, i: number) => (
                      <div key={i} className="flex items-center justify-between rounded bg-white px-2.5 py-1.5 text-xs border border-gray-200">
                        <span className="font-medium text-gray-800">{s.name}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          s.level === 'advanced' ? 'bg-green-100 text-green-700' :
                          s.level === 'intermediate' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{s.level}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Context memories */}
              {memoryData.context.length > 0 && (
                <div className="mb-3">
                  <p className="mb-1.5 text-xs font-semibold text-gray-500 uppercase">Recent Context</p>
                  <div className="space-y-1">
                    {memoryData.context.slice(-8).reverse().map((e: any, i: number) => (
                      <div key={i} className="rounded bg-white px-2.5 py-1.5 text-xs text-gray-600 border border-gray-200">
                        {e.text}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {/* Summarize button */}
              <button
                onClick={summarizeSkills}
                className="w-full rounded bg-[#0078d4] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#106ebe] transition"
              >
                ✨ Summarize to Skills
              </button>
              {memoryData.context.length === 0 && memoryData.skills.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-2">Start chatting to build your learning memory!</p>
              )}
            </div>
          )}
        </div>

        {/* Bottom */}
        <div className="border-t border-gray-200 p-3">
          <button
            onClick={() => {
              setToken(null);
              localStorage.removeItem("token");
              setMessages([]);
              setSessionId(null);
              setSessions([]);
            }}
            className="flex w-full items-center gap-2 rounded px-3 py-2 text-sm text-gray-600 transition hover:bg-[#edebe9]"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Sign out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex flex-1 flex-col">
        {/* Top Bar */}
        <header className="flex items-center gap-3 border-b border-gray-200 bg-white px-4 py-3 shadow-sm">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="rounded p-2 hover:bg-[#edebe9]"
          >
            <svg className="h-5 w-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded bg-[#0078d4]">
              <svg className="h-4 w-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
            </div>
            <h1 className="text-base font-semibold text-gray-800">Azure Learning Mentor</h1>
          </div>
          <span className="ml-auto flex items-center gap-2">
            <a href="/assessment" className="rounded px-3 py-1.5 text-xs font-medium text-[#0078d4] hover:bg-[#deecf9] transition">📝 Quiz</a>
            <a href="/progress" className="rounded px-3 py-1.5 text-xs font-medium text-[#0078d4] hover:bg-[#deecf9] transition">📊 Progress</a>
            <span className="rounded bg-[#0078d4]/10 px-2 py-0.5 text-xs font-medium text-[#0078d4]">Powered by Azure AI</span>
          </span>
        </header>

        {/* Messages Area */}
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl px-4 py-8">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20">
                {/* Azure logo */}
                <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-xl shadow-lg overflow-hidden">
                  <img src="/azure-logo.png" className="h-16 w-16" alt="Azure" />
                </div>
                <h2 className="mb-2 text-2xl font-semibold text-gray-800">Welcome to NextGen Mentor</h2>
                <p className="mb-8 text-base text-gray-500">Your personal Azure learning companion</p>
                {/* Suggestion chips */}
                <div className="grid grid-cols-2 gap-3 max-w-lg">
                  {[
                    "☁️ What is Azure and where do I start?",
                    "🚀 Explain Azure App Service to me",
                    "💾 How does Cosmos DB work?",
                    "🔒 Azure security best practices",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setInput(suggestion)}
                      className="rounded-lg border border-[#0078d4]/20 bg-white px-4 py-3 text-left text-sm text-gray-700 transition hover:border-[#0078d4]/50 hover:bg-[#0078d4]/5 hover:shadow-sm"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className="mb-6">
                {msg.role === "user" ? (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-lg bg-[#0078d4] px-4 py-3 text-white shadow-sm">
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg overflow-hidden">
                      <img src="/azure-logo.png" className="h-8 w-8" alt="Azure" />
                    </div>
                    <div className="max-w-[85%]">
                      <div className="markdown-body text-gray-800 leading-relaxed text-sm">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                      </div>
                      {msg.sources && msg.sources.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {msg.sources.map((src: any, j: number) => {
                            const source = typeof src === 'string' ? { title: src, content: '', chunk_index: 0, score: 0 } : src;
                            return (
                              <button
                                key={j}
                                onClick={() => setReferencePanel(source)}
                                className="inline-flex items-center rounded bg-[#deecf9] px-2.5 py-1 text-xs font-medium text-[#0078d4] transition hover:bg-[#c7e0f4] hover:shadow-sm cursor-pointer"
                              >
                                📄 {source.title}{source.chunk_index != null ? ` (#${source.chunk_index + 1})` : ""}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}

            {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
              <div className="mb-6 flex gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg overflow-hidden">
                  <img src="/azure-logo.png" className="h-8 w-8" alt="Azure" />
                </div>
                <div className="flex items-center gap-1.5 py-2">
                  <span className="h-2 w-2 animate-bounce rounded-full bg-[#0078d4]" style={{ animationDelay: "0ms" }}></span>
                  <span className="h-2 w-2 animate-bounce rounded-full bg-[#0078d4]" style={{ animationDelay: "150ms" }}></span>
                  <span className="h-2 w-2 animate-bounce rounded-full bg-[#0078d4]" style={{ animationDelay: "300ms" }}></span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="border-t border-gray-200 bg-white px-4 py-4">
          <div className="mx-auto max-w-3xl">
            <div className="flex items-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 shadow-sm focus-within:border-[#0078d4] focus-within:shadow-md transition">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                placeholder="Ask me anything about Azure..."
                className="flex-1 bg-transparent text-base outline-none placeholder-gray-400"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="flex h-9 w-9 items-center justify-center rounded bg-[#0078d4] text-white transition hover:bg-[#106ebe] disabled:opacity-40"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
                </svg>
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-gray-400">
              NextGen Mentor uses Azure AI to help you learn. Always verify critical information.
            </p>
          </div>
        </div>
      </main>

      {/* Reference Panel (Right Side) */}
      {referencePanel && (
        <aside className="w-96 flex flex-col border-l border-gray-200 bg-white shadow-lg">
          {/* Panel Header */}
          <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 bg-[#faf9f8]">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-[#0078d4]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <h3 className="text-sm font-semibold text-gray-800">Reference Source</h3>
            </div>
            <button
              onClick={() => setReferencePanel(null)}
              className="rounded p-1 hover:bg-gray-200 transition"
            >
              <svg className="h-4 w-4 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path d="M6 18L18 6M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>

          {/* Source Info */}
          <div className="border-b border-gray-200 px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-lg">📄</span>
              <span className="text-sm font-semibold text-gray-800">{referencePanel.title}</span>
            </div>
            <div className="flex gap-3 text-xs text-gray-500">
              {referencePanel.chunk_index != null && <span>Chunk #{referencePanel.chunk_index + 1}</span>}
              {referencePanel.score != null && referencePanel.score > 0 && <span>Relevance: {Math.round(referencePanel.score * 100)}%</span>}
            </div>
          </div>

          {/* Source Content */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            {referencePanel.content ? (
              <div className="rounded-lg bg-[#f3f2f1] p-4">
                <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">
                  {referencePanel.content}
                </p>
              </div>
            ) : (
              <div className="rounded-lg bg-[#f3f2f1] p-4 text-center">
                <p className="text-sm text-gray-400">Source content not available for this reference.</p>
              </div>
            )}
          </div>

          {/* Panel Footer */}
          <div className="border-t border-gray-200 px-4 py-3">
            <p className="text-xs text-gray-400 text-center">
              Source extracted from training materials
            </p>
          </div>
        </aside>
      )}
    </div>
  );
}
