# 习题与判题服务器验收清单

以下检查应在实际 Linux Docker 服务器上完成。开始前先备份 `kidtype_data` 数据卷，并配置 `.env` 中的管理员密码、会话密钥和可选的 `IMPORT_LLM_*`。

## 构建、迁移与健康检查

```bash
docker compose build --no-cache kidtype judge
docker compose up -d
docker compose ps
docker compose logs --tail=200 kidtype judge
curl -fsS http://127.0.0.1:${APP_PORT:-8080}/api/health
```

- `kidtype` 和 `judge` 均应保持运行，Web 健康检查返回 `{"status":"ok"}`。
- `kidtype` 日志应显示 Alembic 已升级到 `0003_exercises`，且没有数据库或权限异常。
- 重启 `docker compose restart` 后，管理员、题套、PDF 资源和历史练习仍应存在。

## 判题队列与网络隔离

1. 在管理端创建含公开样例和已确认隐藏测试点的 Python 题，发布后以学生身份提交正确程序。
2. 确认页面从“正在判题”变为 `AC`，分值等于通过测试点权重之和。
3. 检查判题容器没有网络：

```bash
docker inspect kidtype-judge --format '{{.HostConfig.NetworkMode}} {{.HostConfig.ReadonlyRootfs}} {{.HostConfig.PidsLimit}}'
docker exec kidtype-judge python -c "import socket; socket.create_connection(('1.1.1.1', 53), 1)"
```

第一条应显示 `none true` 和受限的 PID 数；第二条必须连接失败。不要为了通过测试而给判题容器增加普通网络、宿主目录或 Docker Socket。

## 资源与恶意代码测试

分别提交以下程序，确认 Web 服务持续健康，判题工作器能继续处理后续正常任务：

- `while True: pass`：返回 `TLE`。
- 持续分配大列表：返回 `MLE` 或受控的 `RE`，不能导致宿主机内存持续增长。
- 无限创建子进程：被进程数限制终止。
- 无限打印：输出被限制在 64 KB，任务终止且容器日志不会无限增长。
- 读取 `/queue`、`/data` 或其他任务：权限被拒绝，不能看到题库数据库、隐藏测试或其他提交。
- 使用 `socket`、HTTP 或 DNS：无法访问外网、Web 容器或局域网。
- 语法错误和主动抛异常：分别返回 `Syntax Error` 和 `RE`。

完成恶意代码测试后再次提交正确程序，并重新检查 `/api/health`。

## PDF 真模型验收

1. 配置独立的视觉模型：

```dotenv
IMPORT_LLM_BASE_URL=https://api.openai.com/v1
IMPORT_LLM_API_KEY=replace-me
IMPORT_LLM_MODEL=replace-with-a-vision-model
```

2. 重启 `kidtype`，后台应显示 PDF 识别模型已配置，但不得回显 API Key。
3. 上传样卷 `1753295446081568.pdf`。任务应完成为 10 页草稿，人工核对应得到 15 道选择、10 道判断、2 道编程题，总分 100。
4. 检查代码块、答案表解析、判断答案、跨页编程题和图形题截图；任何识别错误必须在草稿中修正。
5. 未复核题目、缺少正确答案、缺少参考程序或隐藏测试点权重不等于题目分值时，发布必须失败。
6. 发布后以学生身份确认：提交前不返回答案、解析、参考程序或隐藏测试点；提交完成后才展示答案和解析。

## 回退

若迁移或部署异常，停止服务并恢复升级前的 `kidtype_data` 备份。不要在包含真实成绩的数据库上直接执行 Alembic downgrade；应用回退应与数据库备份恢复一起进行。
