# NextGen Mentor — PRD (Product Requirements Document)

## 1. 产品愿景

**一句话描述：** 一个 AI 驱动的虚拟导师，通过 RAG 技术为新员工提供精准的知识问答、自动化培训评估和个性化学习路径。

**目标用户：**
- 企业新员工（需要 onboarding 培训）
- 培训管理者（需要追踪学习进度）
- 知识库管理员（上传维护培训材料）

**核心价值：**
- 24/7 即时问答，减少导师负担
- 回答有据可查（引用来源文档）
- 自动评估学习掌握度，数据驱动决策

---

## 2. MVP 功能清单

### P0 — Must Have（第一阶段）

| # | 功能 | 描述 |
|---|------|------|
| 1 | 用户注册/登录 | Email + 密码注册，JWT token 认证 |
| 2 | 聊天界面 | 类 ChatGPT 的对话 UI，支持多轮对话 |
| 3 | 基础 RAG 问答 | 用户提问 → 向量检索相关文档 → Claude 生成带引用的回答 |
| 4 | 对话历史 | 保存聊天记录，支持查看历史会话 |

### P1 — Should Have（第二阶段）

| # | 功能 | 描述 |
|---|------|------|
| 5 | 文档管理 | 管理员上传 PDF/MD/TXT → 自动分块 → 生成 embeddings → 索引 |
| 6 | 学习进度追踪 | 追踪用户提问频率、主题分布、知识盲区 |
| 7 | 智能评估 | 根据课程内容自动生成测验题，评估掌握度 |
| 8 | 引用来源 | 回答附带文档来源 + 相关段落高亮 |

### P2 — Nice to Have（第三阶段）

| # | 功能 | 描述 |
|---|------|------|
| 9 | 数据看板 | 学习进度可视化，团队整体掌握度 |
| 10 | 个性化学习路径 | 基于薄弱环节推荐学习材料 |
| 11 | 多角色权限 | Admin / Mentor / Learner 不同权限 |
| 12 | 通知提醒 | 学习计划到期提醒，评估结果通知 |

---

## 3. 页面/路由规划

```
/                    → Landing page
/login               → 登录
/register            → 注册
/chat                → 主聊天界面（默认页）
/chat/:sessionId     → 特定对话
/documents           → 文档管理（Admin）
/documents/upload    → 上传文档
/assessment          → 学习评估
/assessment/:quizId  → 答题页面
/progress            → 学习进度
/dashboard           → 数据看板（Admin）
/settings            → 个人设置
```

---

## 4. API 接口设计

### Auth
| Method | Endpoint | 描述 |
|--------|----------|------|
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录，返回 JWT |
| GET | `/api/auth/me` | 获取当前用户信息 |
| POST | `/api/auth/refresh` | 刷新 token |

### Chat
| Method | Endpoint | 描述 |
|--------|----------|------|
| POST | `/api/chat` | 发送消息，返回 AI 回复（streaming） |
| GET | `/api/chat/sessions` | 获取对话列表 |
| GET | `/api/chat/sessions/:id` | 获取特定对话消息历史 |
| DELETE | `/api/chat/sessions/:id` | 删除对话 |

### Documents
| Method | Endpoint | 描述 |
|--------|----------|------|
| POST | `/api/documents/upload` | 上传文档 |
| GET | `/api/documents` | 获取文档列表 |
| DELETE | `/api/documents/:id` | 删除文档 |
| POST | `/api/documents/:id/reindex` | 重新索引 |

### Assessment
| Method | Endpoint | 描述 |
|--------|----------|------|
| POST | `/api/assessment/generate` | 从指定文档生成测验 |
| GET | `/api/assessment/quizzes` | 获取测验列表 |
| POST | `/api/assessment/submit` | 提交答案 |
| GET | `/api/assessment/results` | 获取评估结果 |

### Progress
| Method | Endpoint | 描述 |
|--------|----------|------|
| GET | `/api/progress/me` | 个人学习进度 |
| GET | `/api/progress/dashboard` | 团队看板数据（Admin） |

---

## 5. 数据模型（Cosmos DB）

### Database: `nextgen-mentor`

#### Container: `users` (Partition Key: `/id`)
```json
{
  "id": "uuid",
  "email": "user@example.com",
  "passwordHash": "bcrypt...",
  "displayName": "张三",
  "role": "learner | mentor | admin",
  "createdAt": "2024-09-01T00:00:00Z",
  "lastLoginAt": "2024-09-15T10:00:00Z"
}
```

#### Container: `sessions` (Partition Key: `/userId`)
```json
{
  "id": "session-uuid",
  "userId": "user-uuid",
  "title": "如何配置 Azure Functions",
  "messages": [
    {
      "role": "user",
      "content": "Azure Functions 怎么配置触发器？",
      "timestamp": "2024-09-15T10:00:00Z"
    },
    {
      "role": "assistant",
      "content": "根据文档[1]...",
      "sources": ["doc-uuid-1"],
      "timestamp": "2024-09-15T10:00:01Z"
    }
  ],
  "createdAt": "2024-09-15T10:00:00Z",
  "updatedAt": "2024-09-15T10:05:00Z"
}
```

#### Container: `documents` (Partition Key: `/uploadedBy`)
```json
{
  "id": "doc-uuid",
  "filename": "azure-functions-guide.pdf",
  "uploadedBy": "admin-uuid",
  "contentType": "application/pdf",
  "chunkCount": 42,
  "status": "indexed | processing | failed",
  "createdAt": "2024-09-01T00:00:00Z"
}
```

#### Container: `assessments` (Partition Key: `/userId`)
```json
{
  "id": "assessment-uuid",
  "userId": "user-uuid",
  "documentId": "doc-uuid",
  "questions": [
    {
      "id": "q1",
      "question": "Azure Functions 支持哪些触发器类型？",
      "options": ["A...", "B...", "C...", "D..."],
      "correctAnswer": "B",
      "userAnswer": "B",
      "isCorrect": true
    }
  ],
  "score": 85,
  "completedAt": "2024-09-15T11:00:00Z"
}
```

---

## 6. 非功能需求

| 类别 | 要求 |
|------|------|
| 性能 | 聊天响应首 token < 2s (streaming) |
| 安全 | 密码 bcrypt 加密, JWT 过期时间 24h, HTTPS |
| 可用性 | 支持 5 并发用户（MVP 阶段） |
| 数据 | 用户数据保留 1 年，聊天记录可导出 |
| 兼容性 | Chrome/Edge/Safari 最新版 |

---

## 7. 里程碑

| 阶段 | 时间 | 交付物 |
|------|------|--------|
| Sprint 1 | Week 1 | 项目脚手架 + 认证模块 + 基础聊天 UI |
| Sprint 2 | Week 2 | RAG pipeline + 向量检索 + 带引用回答 |
| Sprint 3 | Week 3 | 文档上传管理 + 学习评估 |
| Sprint 4 | Week 4 | 进度追踪 + 数据看板 + 部署上线 |
