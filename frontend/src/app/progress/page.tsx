"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ProgressPage() {
  const [token, setToken] = useState<string | null>(null);
  const [progress, setProgress] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const API_BASE = "";

  useEffect(() => {
    const saved = localStorage.getItem("token");
    if (!saved) {
      router.push("/");
      return;
    }
    setToken(saved);
    fetchProgress(saved);
  }, []);

  const fetchProgress = async (t: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/progress/me`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      if (res.ok) setProgress(await res.json());
    } finally {
      setLoading(false);
    }
  };

  if (!token || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f3f2f1]">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  const s = progress?.summary || {};

  return (
    <div className="min-h-screen bg-[#f3f2f1]">
      {/* Header */}
      <header className="border-b border-gray-200 bg-white px-6 py-4 shadow-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/azure-logo.png" className="h-8 w-8 rounded" alt="Azure" />
            <h1 className="text-xl font-semibold text-gray-800">Learning Progress</h1>
          </div>
          <div className="flex gap-3">
            <button onClick={() => router.push("/")} className="rounded px-4 py-2 text-sm text-[#0078d4] hover:bg-[#deecf9] transition">
              ← Chat
            </button>
            <button onClick={() => router.push("/assessment")} className="rounded px-4 py-2 text-sm text-[#0078d4] hover:bg-[#deecf9] transition">
              📝 Assessment
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
        {/* Summary Cards */}
        <div className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6">
          <div className="rounded-lg bg-white p-4 shadow-sm border border-gray-200 text-center">
            <p className="text-2xl font-bold text-[#0078d4]">{s.completed_quizzes || 0}</p>
            <p className="text-xs text-gray-500 mt-1">Quizzes Done</p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm border border-gray-200 text-center">
            <p className={`text-2xl font-bold ${(s.avg_score || 0) >= 80 ? 'text-green-600' : (s.avg_score || 0) >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
              {s.avg_score || 0}%
            </p>
            <p className="text-xs text-gray-500 mt-1">Avg Score</p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm border border-gray-200 text-center">
            <p className="text-2xl font-bold text-purple-600">{s.total_sessions || 0}</p>
            <p className="text-xs text-gray-500 mt-1">Chat Sessions</p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm border border-gray-200 text-center">
            <p className="text-2xl font-bold text-orange-600">{s.total_skills || 0}</p>
            <p className="text-xs text-gray-500 mt-1">Skills</p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm border border-gray-200 text-center">
            <p className="text-2xl font-bold text-teal-600">{s.total_memories || 0}</p>
            <p className="text-xs text-gray-500 mt-1">Memories</p>
          </div>
          <div className="rounded-lg bg-white p-4 shadow-sm border border-gray-200 text-center">
            <p className="text-2xl font-bold text-indigo-600">{s.total_quizzes || 0}</p>
            <p className="text-xs text-gray-500 mt-1">Total Quizzes</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Skills */}
          <div className="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
            <h2 className="mb-4 text-lg font-semibold text-gray-800">🎯 Skills</h2>
            {progress?.skills?.length > 0 ? (
              <div className="space-y-3">
                {progress.skills.map((skill: any, i: number) => (
                  <div key={i} className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-medium text-gray-800">{skill.name}</span>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          skill.level === 'advanced' ? 'bg-green-100 text-green-700' :
                          skill.level === 'intermediate' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>{skill.level}</span>
                      </div>
                      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            skill.level === 'advanced' ? 'bg-green-500 w-full' :
                            skill.level === 'intermediate' ? 'bg-blue-500 w-2/3' :
                            'bg-gray-400 w-1/3'
                          }`}
                        ></div>
                      </div>
                      {skill.notes && <p className="text-xs text-gray-500 mt-1">{skill.notes}</p>}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">
                No skills yet. Chat with the mentor and take quizzes to build your skill profile!
              </p>
            )}
          </div>

          {/* Topic Performance */}
          <div className="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
            <h2 className="mb-4 text-lg font-semibold text-gray-800">📊 Topic Performance</h2>
            {progress?.topic_breakdown?.length > 0 ? (
              <div className="space-y-3">
                {progress.topic_breakdown.map((t: any, i: number) => (
                  <div key={i} className="rounded-lg border border-gray-200 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-800">{t.topic}</span>
                      <span className={`text-sm font-bold ${
                        t.avg_score >= 80 ? 'text-green-600' : t.avg_score >= 60 ? 'text-yellow-600' : 'text-red-600'
                      }`}>{t.avg_score}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          t.avg_score >= 80 ? 'bg-green-500' : t.avg_score >= 60 ? 'bg-yellow-500' : 'bg-red-500'
                        }`}
                        style={{ width: `${t.avg_score}%` }}
                      ></div>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{t.attempts} attempt(s) • Best: {t.best_score}%</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">
                Take some quizzes to see your performance by topic!
              </p>
            )}
          </div>

          {/* Activity Timeline */}
          <div className="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
            <h2 className="mb-4 text-lg font-semibold text-gray-800">📅 Activity (Last 7 Days)</h2>
            <div className="flex items-end justify-between gap-2 h-32">
              {progress?.activity?.map((day: any, i: number) => {
                const total = day.quizzes + day.chats + day.memories;
                const height = total > 0 ? Math.max(20, Math.min(100, total * 20)) : 4;
                return (
                  <div key={i} className="flex flex-col items-center flex-1">
                    <div
                      className="w-full rounded-t bg-[#0078d4] transition-all"
                      style={{ height: `${height}%` }}
                      title={`${day.date}: ${day.quizzes} quizzes, ${day.chats} chats, ${day.memories} memories`}
                    ></div>
                    <p className="mt-2 text-[10px] text-gray-500">
                      {new Date(day.date).toLocaleDateString('en', { weekday: 'short' })}
                    </p>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Recent Quizzes */}
          <div className="rounded-lg bg-white p-6 shadow-sm border border-gray-200">
            <h2 className="mb-4 text-lg font-semibold text-gray-800">🏆 Recent Quizzes</h2>
            {progress?.recent_quizzes?.length > 0 ? (
              <div className="space-y-2">
                {progress.recent_quizzes.map((q: any, i: number) => (
                  <div key={i} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{q.topic}</p>
                      <p className="text-xs text-gray-500">{q.difficulty} • {q.completed_at ? new Date(q.completed_at).toLocaleDateString() : ''}</p>
                    </div>
                    <span className={`text-sm font-bold ${
                      q.score >= 80 ? 'text-green-600' : q.score >= 60 ? 'text-yellow-600' : 'text-red-600'
                    }`}>{q.score}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400 text-center py-8">
                No quizzes completed yet. Go to Assessment to take your first quiz!
              </p>
            )}
          </div>

          {/* Difficulty Breakdown */}
          <div className="rounded-lg bg-white p-6 shadow-sm border border-gray-200 lg:col-span-2">
            <h2 className="mb-4 text-lg font-semibold text-gray-800">📈 Difficulty Breakdown</h2>
            <div className="grid grid-cols-3 gap-4">
              {["beginner", "intermediate", "advanced"].map((diff) => {
                const data = progress?.difficulty_breakdown?.[diff] || { avg_score: 0, count: 0 };
                return (
                  <div key={diff} className="text-center rounded-lg border border-gray-200 p-4">
                    <p className="text-xs font-medium text-gray-500 uppercase mb-2">{diff}</p>
                    <p className={`text-3xl font-bold ${
                      data.avg_score >= 80 ? 'text-green-600' :
                      data.avg_score >= 60 ? 'text-yellow-600' :
                      data.count > 0 ? 'text-red-600' : 'text-gray-300'
                    }`}>{data.count > 0 ? `${data.avg_score}%` : '—'}</p>
                    <p className="text-xs text-gray-500 mt-1">{data.count} quiz(es)</p>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
