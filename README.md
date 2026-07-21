# 码力全开

源乐科技打造的家庭及局域网儿童英文/代码打字练习平台。包含孩子 PIN 登录、管理员后台、自定义课程词库、逐键提示、练习历史和薄弱按键分析，所有数据保存在本地 SQLite 中。

项目主页：[freefoxcm/typing](https://github.com/freefoxcm/typing)

版权所有 © 2026 源乐科技。

## 主要功能

- 严格逐字符练习：错误不前进，实时显示 CPM、准确率、错误和用时。
- US ANSI 虚拟键盘、左右手提示、大小写、数字、符号、Enter 和 Tab。
- 管理员维护孩子档案、课程、关卡和练习内容。
- 独立单词练习：每轮随机洗牌，输入时同步展示美式音标、常用中文释义和计算机领域释义。
- 单词资料缺失时可通过 OpenAI 兼容接口在后台自动补全，失败任务可重试。
- TXT、CSV、JSON 预览导入，JSON 词库备份，CSV 成绩导出。
- 在线习题：单选、多选、判断和 Python 编程题，支持整套练习、随机组题和错题重练。
- PDF 试卷通过独立视觉模型识别为可校对草稿；编程题由无网络判题工作器执行公开样例和隐藏测试点。
- SQLite 持久化；密码和 PIN 使用 Argon2 哈希。

## Docker 部署

项目根目录执行：

```bash
cp .env.example .env
```

编辑 `.env`，至少替换 `ADMIN_PASSWORD` 和 `SESSION_SECRET`。`SESSION_SECRET` 建议使用 32 字节以上的随机字符串。然后启动：

```bash
docker compose up -d --build
```

如需自动补全单词资料，另行设置 `LLM_API_KEY` 和 `LLM_MODEL`；`LLM_BASE_URL` 默认是 `https://api.openai.com/v1`，也可改为其他兼容 Chat Completions 的服务。修改这些配置后需要重启容器。未配置 LLM 时，完整词条仍可正常练习，缺少音标或常用释义的词条会保留在等待状态。

访问 `http://服务器地址:8080`。首次启动会创建管理员和少量原创示例课程。数据库位于名为 `kidtype_data` 的 Docker 卷中。

查看状态与日志：

```bash
docker compose ps
docker compose logs -f kidtype
docker compose logs -f judge
```

编程题判题依赖 `judge` 服务。它没有网络和公开端口，通过专用卷与 Web 应用交换任务。PDF 智能导入另需配置 `IMPORT_LLM_API_KEY` 和 `IMPORT_LLM_MODEL`；这组配置与单词补全使用的 `LLM_*` 相互独立。完整的部署与隔离验收步骤见 [习题与判题服务器验收清单](docs/exercise-server-checklist.md)。

升级时拉取或替换代码，然后重新运行 `docker compose up -d --build`；容器启动会自动执行 Alembic 数据库迁移。

## 数据备份

词库可在管理后台导出 JSON。完整备份应在停止容器后备份 Docker 卷中的 `/data/typing.db`：

```bash
docker compose stop kidtype
docker run --rm -v kidtype_data:/data -v "$PWD":/backup alpine cp /data/typing.db /backup/typing.db
docker compose start kidtype
```

恢复数据库前请先停止容器，并保留原文件作为回退备份。

## 反向代理与 HTTPS

如果通过 HTTPS 反向代理访问，将 `.env` 中的 `COOKIE_SECURE` 改为 `true`，把 `TRUSTED_HOSTS` 设置为实际域名，并按代理地址配置 `FORWARDED_ALLOW_IPS`。应用自身默认只提供 HTTP。

## 本地开发

后端：

```bash
python -m venv .venv
.venv/Scripts/pip install -r backend/requirements-dev.txt
set DATABASE_URL=sqlite:///./typing-dev.db
cd backend
uvicorn app.main:app --reload
```

前端：

```bash
cd frontend
npm install
npm run dev
```

测试与构建：

```bash
cd backend && pytest
cd frontend && npm test && npm run build
```

## 导入格式

- TXT：每个非空行是一条练习，导入时选择目标关卡。
- CSV：必须包含 `course,lesson,prompt`，可选 `order,enabled`。
- JSON：使用后台导出的层级结构；多行代码可放在 JSON 或带引号的 CSV 字段中。

练习文本只接受可打印 ASCII、换行和 Tab；课程与关卡名称可以使用中文。

单词库导入时需选择目标单词集：

- TXT：每个非空行一个单词或技术术语。
- CSV：必须包含 `word`，可选 `phonetic,meaning_zh,technical_meaning_zh,active`。
- JSON：根对象使用 `{"words":[...]}`，词条字段与 CSV 相同。

同一单词集内的词条忽略大小写和多余空格去重。再次导入时，非空字段覆盖旧内容，空字段保留旧内容。

## 开源许可

除另有说明外，本项目采用 [GNU Affero General Public License v3.0 or later](LICENSE)（`AGPL-3.0-or-later`）许可。

你可以使用、复制、修改和分发本项目，也可以用于商业用途，但必须遵守 AGPL-3.0-or-later 的条款。特别是，如果修改后的程序通过网络向用户提供服务，应当向这些用户提供该运行版本的完整对应源代码。

`practice-data/us.json` 由 KTouch 课程数据转换而来，不适用本项目的默认许可；其来源、修改和许可信息见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

本项目按“原样”提供，不附带任何明示或默示担保。完整条款以 [LICENSE](LICENSE) 中的英文协议正文为准。
