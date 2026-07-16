# Etymae

本地运行的轻量词源卡片系统，以卡片形式显示多语言词汇词源关系，辅助词汇的记忆和理解。技术栈为 `React + Vite + TypeScript`、`FastAPI`、`SQLite`。

## 启动方式

### 后端

```bash
python -m venv .venv
.venv/Scripts/activate
pip install -r backend/requirements.txt
uvicorn backend.app.main:app --reload --port 20262
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

打开 `http://localhost:22026`。

## 当前特性

- 顶部搜索栏
- 新增、隐藏、修改、删除单词卡片
- 为单词自动建立多语言上下游关联
    - 上游关联自动解析；无法匹配时保留为红色未解析项
    - 下游关联根据已有上游关系自动反推
- 跨语言拼写冲突提示、别名冲突提示、自身重叠提示