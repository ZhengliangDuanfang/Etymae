# Etymae

本地运行的轻量词源卡片系统，以卡片形式显示多语言词汇词源关系，辅助词汇的记忆和理解。技术栈为 `React + Vite + TypeScript`、`FastAPI`、`SQLite`。

## 启动方式

### Windows 一键启动

项目根目录提供了 `start-windows.bat`。

- 直接双击这个文件，会分别打开后端和前端两个命令行窗口
- 脚本会自动检查 `.venv`、`frontend/node_modules` 和 `npm` 是否存在
- 成功启动后会自动打开 `http://127.0.0.1:22026`

如果想在 Git Bash 里执行，也可以在项目根目录运行：

```bash
./start-windows.bat
```

首次使用前，仍需先完成依赖安装：

```bash
python -m venv .venv
.venv/Scripts/pip install -r backend/requirements.txt
cd frontend
npm install
```

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

测试：`npm run test:e2e`（可视化`npm run test:e2e:live`）

## 当前特性

- 顶部搜索栏
- 新增、隐藏、修改、删除单词卡片
- 导出全部词条为 CSV，并用 CSV 一次性覆盖导入数据库
- 为单词自动建立多语言上下游关联
    - 上游关联自动解析；无法匹配时保留为红色未解析项
    - 下游关联根据已有上游关系自动反推
- 跨语言拼写冲突提示、别名冲突提示、自身重叠提示
