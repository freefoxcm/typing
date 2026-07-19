# 国内依赖镜像

默认的 `compose.yaml` 和 `Dockerfile.cn` 已固定使用以下镜像：

- pip：`https://mirrors.aliyun.com/pypi/simple`
- npm：`https://registry.npmmirror.com/`

服务器上仍然使用正常命令即可：

```bash
docker compose up -d --build
```

本地前端会自动读取 `frontend/.npmrc`。本地安装 Python 依赖可执行：

```bash
pip install -r backend/requirements-cn.txt
```

也可以临时启用项目中的 pip 配置：

```bash
PIP_CONFIG_FILE=backend/pip.conf pip install -r backend/requirements-dev.txt
```

