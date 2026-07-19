from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware

from .config import Settings, get_settings
from .database import Base, create_db
from .routers import admin, auth, library, practice
from .seed import bootstrap


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    engine, session_factory = create_db(settings.database_url)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if settings.auto_create_schema:
            Base.metadata.create_all(engine)
        with session_factory() as db:
            bootstrap(db, settings)
        yield
        engine.dispose()

    app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
    app.state.engine = engine
    app.state.session_factory = session_factory
    app.dependency_overrides[get_settings] = lambda: settings
    if settings.hosts and settings.hosts != ["*"]:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.hosts)

    @app.middleware("http")
    async def same_origin_writes(request: Request, call_next):
        if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.url.path.startswith("/api/"):
            origin = request.headers.get("origin")
            host = request.headers.get("host", "")
            if origin and urlparse(origin).netloc != host:
                return JSONResponse(status_code=403, content={"detail": "请求来源不受信任"})
        return await call_next(request)

    @app.get("/api/health", tags=["system"])
    def health():
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(library.router)
    app.include_router(practice.router)
    app.include_router(admin.router)

    dist = Path(settings.frontend_dist)
    assets = dist / "assets"
    if assets.exists():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def frontend(full_path: str):
        index = dist / "index.html"
        if index.exists():
            return FileResponse(index)
        return JSONResponse(status_code=503, content={"detail": "前端尚未构建"})

    return app


app = create_app()
