"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface Quiz {
  id: string;
  topic: string;
  difficulty: string;
  questions: { id: string; type: string; question: string; options?: string[] }[];
  status: string;
  score?: number;
}

export default function AssessmentPage() {
  const [token, setToken] = useState<string | null>(null);
  const [quizzes, setQuizzes] = useState<any[]>([]);
  const [currentQuiz, setCurrentQuiz] = useState<Quiz | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [results, setResults] = useState<any>(null);
  const [generating, setGenerating] = useState(false);
  const [topic, setTopic] = useState("");
  const [numQuestions, setNumQuestions] = useState(5);
  const [difficulty, setDifficulty] = useState("intermediate");
  const router = useRouter();

  const API_BASE = "";

  useEffect(() => {
    const saved = localStorage.getItem("token");
    if (!saved) {
      router.push("/");
      return;
    }
    setToken(saved);
    fetchQuizzes(saved);
  }, []);

  const fetchQuizzes = async (t: string) => {
    const res = await fetch(`${API_BASE}/api/assessment/quizzes`, {
      headers: { Authorization: `Bearer ${t}` },
    });
    if (res.ok) setQuizzes(await res.json());
  };

  const generateQuiz = async () => {
    if (!topic.trim() || !token) return;
    setGenerating(true);
    try {
      const res = await fetch(`${API_BASE}/api/assessment/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ topic, num_questions: numQuestions, difficulty }),
      });
      if (res.ok) {
        const quiz = await res.json();
        setCurrentQuiz(quiz);
        setAnswers({});
        setResults(null);
        fetchQuizzes(token);
      }
    } finally {
      setGenerating(false);
    }
  };

  const submitQuiz = async () => {
    if (!currentQuiz || !token) return;
    const res = await fetch(`${API_BASE}/api/assessment/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ quiz_id: currentQuiz.id, answers }),
    });
    if (res.ok) {
      const data = await res.json();
      setResults(data);
      fetchQuizzes(token);
    }
  };

  if (!token) return null;

  return (
    <div className="min-h-screen bg-[#f3f2f1]">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-6 py-4 shadow-sm">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/azure-logo.png" className="h-8 w-8 rounded" alt="Azure" />
            <h1 className="text-xl font-semibold text-gray-800">Learning Assessment</h1>
          </div>
          <div className="flex gap-3">
            <button onClick={() => router.push("/")} className="rounded px-4 py-2 text-sm text-[#0078d4] hover:bg-[#deecf9] transition">
              ← Back to Chat
            </button>
            <button onClick={() => router.push("/progress")} className="rounded px-4 py-2 text-sm text-[#0078d4] hover:bg-[#deecf9] transition">
              📊 Progress
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        {/* Quiz Generator */}
        {!currentQuiz && !results && (
          <div className="mb-8 rounded-lg bg-white p-6 shadow-sm border border-gray-200">
            <h2 className="mb-4 text-lg font-semibold text-gray-800">📝 Generate a Quiz</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-gray-600">Topic</label>
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="e.g. Azure App Service, Cosmos DB, Virtual Machines"
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-[#0078d4] focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-600">Questions</label>
                <select
                  value={numQuestions}
                  onChange={(e) => setNumQuestions(Number(e.target.value))}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-[#0078d4] focus:outline-none"
                >
                  <option value={3}>3</option>
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-600">Difficulty</label>
                <select
                  value={difficulty}
                  onChange={(e) => setDifficulty(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm focus:border-[#0078d4] focus:outline-none"
                >
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </div>
            </div>
            <button
              onClick={generateQuiz}
              disabled={generating || !topic.trim()}
              className="mt-4 rounded-lg bg-[#0078d4] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#106ebe] disabled:opacity-50 transition"
            >
              {generating ? "Generating..." : "🎯 Generate Quiz"}
            </button>
          </div>
        )}

        {/* Active Quiz */}
        {currentQuiz && !results && (
          <div className="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-800">{currentQuiz.topic}</h2>
                <p className="text-sm text-gray-500">
                  {currentQuiz.questions.length} questions • {currentQuiz.difficulty}
                </p>
              </div>
              <button
                onClick={() => { setCurrentQuiz(null); setAnswers({}); }}
                className="text-sm text-gray-500 hover:text-gray-700"
              >
                ✕ Cancel
              </button>
            </div>

            <div className="space-y-6">
              {currentQuiz.questions.map((q, i) => (
                <div key={q.id} className="rounded-lg border border-gray-200 p-4">
                  <p className="mb-3 font-medium text-gray-800">
                    <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#0078d4] text-xs text-white">{i + 1}</span>
                    {q.question}
                    <span className={`ml-2 text-xs font-normal px-2 py-0.5 rounded ${q.type === 'open' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {q.type === 'open' ? 'Open Answer' : 'Multiple Choice'}
                    </span>
                  </p>
                  {q.type === 'open' ? (
                    <textarea
                      value={answers[q.id] || ''}
                      onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                      placeholder="Type your answer here..."
                      rows={4}
                      className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-[#0078d4] focus:outline-none resize-none"
                    />
                  ) : (
                    <div className="space-y-2">
                      {q.options?.map((opt, j) => (
                        <label
                          key={j}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-2.5 transition ${
                            answers[q.id] === opt[0]
                              ? "border-[#0078d4] bg-[#deecf9]"
                              : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          <input
                            type="radio"
                            name={q.id}
                            value={opt[0]}
                            checked={answers[q.id] === opt[0]}
                            onChange={() => setAnswers({ ...answers, [q.id]: opt[0] })}
                            className="accent-[#0078d4]"
                          />
                          <span className="text-sm text-gray-700">{opt}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-between">
              <p className="text-sm text-gray-500">
                Answered: {Object.keys(answers).filter(k => answers[k]?.trim()).length}/{currentQuiz.questions.length}
              </p>
              <button
                onClick={submitQuiz}
                disabled={Object.keys(answers).filter(k => answers[k]?.trim()).length < currentQuiz.questions.length}
                className="rounded-lg bg-[#0078d4] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#106ebe] disabled:opacity-50 transition"
              >
                ✅ Submit Answers
              </button>
            </div>
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
            <div className="mb-6 text-center">
              <div className={`inline-flex h-20 w-20 items-center justify-center rounded-full text-3xl font-bold ${
                results.score >= 80 ? "bg-green-100 text-green-700" :
                results.score >= 60 ? "bg-yellow-100 text-yellow-700" :
                "bg-red-100 text-red-700"
              }`}>
                {results.score}%
              </div>
              <p className="mt-3 text-lg font-semibold text-gray-800">
                {results.score >= 80 ? "🎉 Excellent!" : results.score >= 60 ? "👍 Good job!" : "📚 Keep learning!"}
              </p>
              <p className="text-sm text-gray-500">
                {results.correct}/{results.total} correct answers
              </p>
            </div>

            <div className="space-y-4">
              {results.results.map((r: any, i: number) => (
                <div key={i} className={`rounded-lg border p-4 ${r.is_correct ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
                  <p className="mb-2 font-medium text-gray-800">
                    {r.is_correct ? "✅" : "❌"} {r.question}
                    <span className={`ml-2 text-xs px-2 py-0.5 rounded ${r.type === 'open' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                      {r.type === 'open' ? 'Open' : 'MCQ'}
                    </span>
                  </p>
                  {r.type === 'open' ? (
                    <div className="space-y-2">
                      <div className="rounded bg-white p-3 border border-gray-200">
                        <p className="text-xs font-medium text-gray-500 mb-1">Your answer:</p>
                        <p className="text-sm text-gray-700">{r.user_answer || '(no answer)'}</p>
                      </div>
                      {r.score != null && (
                        <p className="text-sm"><span className="font-medium">Score:</span> {r.score}/100</p>
                      )}
                      {r.feedback && (
                        <p className="text-sm text-gray-600">💬 <span className="italic">{r.feedback}</span></p>
                      )}
                      {r.sample_answer && (
                        <div className="rounded bg-blue-50 p-3 border border-blue-200">
                          <p className="text-xs font-medium text-blue-700 mb-1">💡 Model answer:</p>
                          <p className="text-sm text-blue-800">{r.sample_answer}</p>
                        </div>
                      )}
                      {r.key_points && r.key_points.length > 0 && (
                        <div className="text-xs text-gray-500">
                          <span className="font-medium">Key points:</span> {r.key_points.join(' • ')}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>
                      <p className="text-sm text-gray-600">
                        Your answer: <span className="font-medium">{r.user_answer}</span>
                        {!r.is_correct && <> • Correct: <span className="font-medium text-green-700">{r.correct_answer}</span></>}
                      </p>
                      {r.explanation && (
                        <p className="mt-1 text-sm text-gray-500 italic">💡 {r.explanation}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                onClick={() => { setCurrentQuiz(null); setResults(null); setAnswers({}); }}
                className="rounded-lg bg-[#0078d4] px-6 py-2.5 text-sm font-medium text-white hover:bg-[#106ebe] transition"
              >
                Take Another Quiz
              </button>
              <button
                onClick={() => router.push("/progress")}
                className="rounded-lg border border-[#0078d4] px-6 py-2.5 text-sm font-medium text-[#0078d4] hover:bg-[#deecf9] transition"
              >
                View Progress
              </button>
            </div>
          </div>
        )}

        {/* Quiz History */}
        {!currentQuiz && !results && quizzes.length > 0 && (
          <div className="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
            <h2 className="mb-4 text-lg font-semibold text-gray-800">📋 Quiz History</h2>
            <div className="space-y-2">
              {quizzes.map((q) => (
                <div key={q.id} className="flex items-center justify-between rounded-lg border border-gray-200 px-4 py-3">
                  <div>
                    <p className="font-medium text-gray-800">{q.topic}</p>
                    <p className="text-xs text-gray-500">{q.difficulty} • {new Date(q.createdAt).toLocaleDateString()}</p>
                  </div>
                  {q.status === "completed" ? (
                    <span className={`rounded-full px-3 py-1 text-sm font-medium ${
                      q.score >= 80 ? "bg-green-100 text-green-700" :
                      q.score >= 60 ? "bg-yellow-100 text-yellow-700" :
                      "bg-red-100 text-red-700"
                    }`}>
                      {q.score}%
                    </span>
                  ) : (
                    <span className="rounded-full bg-gray-100 px-3 py-1 text-sm text-gray-500">Pending</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
