# ============================================================
# HiveOps Makefile - 常用命令一键化
# 支持 Windows (PowerShell / WSL) / macOS / Linux
# ============================================================

SHELL := /bin/bash
.DEFAULT_GOAL := help

# ---------- 环境变量检测 ----------
ENV_FILE := .env
ENV_EXAMPLE := .env.example
DOCKER_COMPOSE_BASE := docker compose -f docker-compose.yml
DOCKER_COMPOSE_DEV := $(DOCKER_COMPOSE_BASE)
DOCKER_COMPOSE_PROD := $(DOCKER_COMPOSE_BASE) -f docker-compose.prod.yml

# ============================================================
# Help 菜单
# ============================================================
.PHONY: help
help: ## 显示帮助信息
	@echo "╔══════════════════════════════════════════════════════════╗"
	@echo "║                 HiveOps Makefile                         ║"
	@echo "╠══════════════════════════════════════════════════════════╣"
	@echo "║                                                          ║"
	@echo "║  用法: make <target>                                     ║"
	@echo "║                                                          ║"
	@grep -E '^[a-zA-Z0-9_-]+:.*##' $(MAKEFILE_LIST) \
		| sort \
		| awk 'BEGIN {FS = ":.*## "}; {printf "║  %-25s - %s\n", $$1, $$2}' \
		| sed 's/$$/  ║/'
	@echo "║                                                          ║"
	@echo "╚══════════════════════════════════════════════════════════╝"

# ============================================================
# Setup / 初始化
# ============================================================
.PHONY: setup
setup: env-check pre-commit-install ## 一键初始化（环境文件 + pre-commit）
	@echo "✅ 初始化完成！请运行 'make dev' 启动开发环境"

.PHONY: env-check
env-check: ## 检查并复制 .env.example 到 .env（如不存在）
	@if [ ! -f $(ENV_FILE) ]; then \
		echo "📄 .env 不存在，从 $(ENV_EXAMPLE) 创建..."; \
		cp $(ENV_EXAMPLE) $(ENV_FILE); \
		echo "⚠️  请编辑 $(ENV_FILE) 修改默认密码和密钥！"; \
	else \
		echo "✅ .env 已存在，跳过创建"; \
	fi

.PHONY: pre-commit-install
pre-commit-install: ## 安装 pre-commit 钩子
	@if ! command -v pre-commit >/dev/null 2>&1; then \
		echo "📦 安装 pre-commit..."; \
		pip install pre-commit || python -m pip install pre-commit; \
	fi
	@pre-commit install
	@pre-commit install --hook-type commit-msg || true
	@echo "✅ pre-commit 钩子已安装"

# ============================================================
# Dev / 本地开发
# ============================================================
.PHONY: dev
dev: env-check ## 启动本地开发环境（热重载 + debug 端口，自动加载 override）
	$(DOCKER_COMPOSE_DEV) up --build

.PHONY: dev-d
dev-d: env-check ## 后台启动本地开发环境
	$(DOCKER_COMPOSE_DEV) up -d --build
	@echo "🌐 服务已启动:"
	@echo "   Frontend : http://localhost:$${FRONTEND_PORT:-3000}"
	@echo "   Backend  : http://localhost:$${BACKEND_PORT:-8000}"
	@echo "   Debug    : localhost:$${BACKEND_DEBUG_PORT:-5678} (Python attach)"
	@echo "   MinIO    : http://localhost:$${MINIO_CONSOLE_PORT:-9001}"
	@echo "   Prometheus: http://localhost:$${PROMETHEUS_PORT:-9090}"

.PHONY: dev-logs
dev-logs: ## 查看开发环境日志（带 follow）
	$(DOCKER_COMPOSE_DEV) logs -f --tail=100

.PHONY: dev-down
dev-down: ## 停止开发环境（保留 volumes）
	$(DOCKER_COMPOSE_DEV) down

.PHONY: dev-restart
dev-restart: dev-down dev-d ## 重启开发环境

.PHONY: backend-shell
backend-shell: ## 进入 backend 容器交互 shell
	$(DOCKER_COMPOSE_DEV) exec backend /bin/sh

.PHONY: frontend-shell
frontend-shell: ## 进入 frontend 容器交互 shell
	$(DOCKER_COMPOSE_DEV) exec frontend /bin/sh

.PHONY: db-shell
db-shell: ## 进入 PostgreSQL psql
	@$(DOCKER_COMPOSE_DEV) exec db psql -U $${POSTGRES_USER:-user} -d $${POSTGRES_DB:-prometheus_db}

# ============================================================
# Test / 测试
# ============================================================
.PHONY: test
test: test-backend lint ## 运行全部测试（后端 + lint）

.PHONY: test-backend
test-backend: ## 运行后端 Python 测试
	@cd backend && \
		if [ ! -d .venv ]; then \
			echo "📦 创建后端虚拟环境..."; \
			python -m venv .venv; \
			source .venv/bin/activate 2>/dev/null || .venv\Scripts\activate 2>/dev/null || true; \
			pip install -q -r requirements.txt; \
			pip install -q pytest pytest-asyncio httpx; \
		else \
			source .venv/bin/activate 2>/dev/null || .venv\Scripts\activate 2>/dev/null || true; \
		fi; \
		python -m pytest tests/ -v --tb=short

.PHONY: test-backend-docker
test-backend-docker: ## 在 Docker 中运行后端测试
	$(DOCKER_COMPOSE_DEV) run --rm backend sh -c "pip install -q pytest pytest-asyncio httpx && python -m pytest tests/ -v --tb=short"

.PHONY: lint
lint: lint-python lint-frontend lint-docker ## 运行全部 lint

.PHONY: lint-python
lint-python: ## 运行 Python lint (ruff)
	@cd backend && \
		if command -v ruff >/dev/null 2>&1; then \
			ruff check .; \
		else \
			echo "⚠️  ruff 未安装，尝试通过 pre-commit 运行..."; \
			cd .. && pre-commit run ruff --files backend/main.py 2>/dev/null || echo "跳过 Python lint"; \
		fi

.PHONY: lint-frontend
lint-frontend: ## 运行前端 lint (eslint + prettier check)
	@cd frontend && \
		if [ -d node_modules ]; then \
			npx eslint src/ --max-warnings=0 2>/dev/null || echo "ESLint 未配置，跳过"; \
			npx prettier --check "src/**/*.{js,jsx,css}" 2>/dev/null || echo "Prettier 检查跳过"; \
		else \
			echo "⚠️  node_modules 不存在，请先运行 'cd frontend && npm install'"; \
		fi

.PHONY: lint-docker
lint-docker: ## 运行 Dockerfile lint (hadolint)
	@if command -v hadolint >/dev/null 2>&1; then \
		hadolint backend/Dockerfile frontend/Dockerfile; \
	elif command -v docker >/dev/null 2>&1; then \
		docker run --rm -i hadolint/hadolint < backend/Dockerfile; \
		docker run --rm -i hadolint/hadolint < frontend/Dockerfile; \
	else \
		echo "⚠️  hadolint 不可用，跳过 Docker lint"; \
	fi

.PHONY: format
format: ## 运行代码格式化 (black / ruff-format / prettier)
	@cd backend && \
		if command -v ruff >/dev/null 2>&1; then \
			ruff format .; \
			ruff check --fix .; \
		fi
	@cd frontend && \
		if [ -d node_modules ]; then \
			npx prettier --write "src/**/*.{js,jsx,css,json,md}"; \
		fi
	@pre-commit run trailing-whitespace end-of-file-fixer pretty-format-json --all-files 2>/dev/null || true

.PHONY: pre-commit-all
pre-commit-all: ## 手动运行所有 pre-commit 钩子（全量文件）
	pre-commit run --all-files

# ============================================================
# Build / 构建
# ============================================================
.PHONY: build
build: build-backend build-frontend ## 构建所有镜像（开发配置）

.PHONY: build-backend
build-backend: ## 构建 backend 镜像
	$(DOCKER_COMPOSE_BASE) build backend

.PHONY: build-frontend
build-frontend: ## 构建 frontend 镜像
	$(DOCKER_COMPOSE_BASE) build frontend

.PHONY: build-prod
build-prod: ## 构建所有生产镜像
	$(DOCKER_COMPOSE_PROD) build

# ============================================================
# Production / 生产部署
# ============================================================
.PHONY: prod-up
prod-up: env-check build-prod ## 启动生产环境（后台 + 加固配置）
	$(DOCKER_COMPOSE_PROD) up -d
	@echo "🚀 生产环境已启动"

.PHONY: prod-down
prod-down: ## 停止生产环境（保留 volumes）
	$(DOCKER_COMPOSE_PROD) down

.PHONY: prod-logs
prod-logs: ## 查看生产环境日志
	$(DOCKER_COMPOSE_PROD) logs -f --tail=100

.PHONY: prod-status
prod-status: ## 查看生产环境容器状态 + 健康检查
	$(DOCKER_COMPOSE_PROD) ps

.PHONY: prod-pull
prod-pull: ## 拉取基础镜像最新版
	$(DOCKER_COMPOSE_PROD) pull

# ============================================================
# Clean / 清理
# ============================================================
.PHONY: clean
clean: clean-containers clean-volumes clean-pyc clean-node clean-cache ## 深度清理（容器 + 数据 + 缓存）
	@echo "🧹 深度清理完成"

.PHONY: clean-containers
clean-containers: ## 停止并删除所有容器（保留 volumes）
	$(DOCKER_COMPOSE_DEV) down
	$(DOCKER_COMPOSE_PROD) down 2>/dev/null || true

.PHONY: clean-volumes
clean-volumes: clean-containers ## 删除所有 named volumes（数据库 + MinIO 数据将丢失！）
	@echo "⚠️  这将删除所有持久化数据！5 秒后继续，Ctrl+C 取消..."
	@sleep 5
	$(DOCKER_COMPOSE_BASE) down -v
	@echo "💾 Volumes 已删除"

.PHONY: clean-pyc
clean-pyc: ## 清理 Python 字节码和缓存
	find backend -type f -name "*.py[cod]" -delete 2>/dev/null || true
	find backend -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find backend -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true
	find backend -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
	rm -rf backend/.venv 2>/dev/null || true
	@echo "🧹 Python 缓存已清理"

.PHONY: clean-node
clean-node: ## 清理前端 node_modules 和构建产物
	rm -rf frontend/node_modules 2>/dev/null || true
	rm -rf frontend/dist 2>/dev/null || true
	@echo "🧹 Frontend 缓存已清理"

.PHONY: clean-cache
clean-cache: ## 清理 Docker build 缓存 + pre-commit cache
	docker builder prune -f 2>/dev/null || true
	pre-commit clean 2>/dev/null || true
	rm -rf .pytest_cache 2>/dev/null || true
	@echo "🧹 缓存已清理"

.PHONY: nuke
nuke: clean ## 最终清理：含 Docker images
	docker system prune -af 2>/dev/null || true
	@echo "☢️  核弹级清理完成"

# ============================================================
# Database / 数据库工具
# ============================================================
.PHONY: db-dump
db-dump: ## 备份数据库到 ./backups/db-<timestamp>.sql
	@mkdir -p backups
	@timestamp=$$(date +%Y%m%d-%H%M%S); \
	$(DOCKER_COMPOSE_DEV) exec -T db pg_dump -U $${POSTGRES_USER:-user} $${POSTGRES_DB:-prometheus_db} > backups/db-$$timestamp.sql
	@echo "💾 数据库已备份到 backups/db-$$timestamp.sql"

.PHONY: db-restore
db-restore: ## 从 ./backups/latest.sql 恢复数据库（需要先 make dev-up）
	@if [ -z "$(FILE)" ]; then \
		echo "❌ 用法: make db-restore FILE=./backups/db-xxx.sql"; \
		exit 1; \
	fi
	@if [ ! -f "$(FILE)" ]; then \
		echo "❌ 文件不存在: $(FILE)"; \
		exit 1; \
	fi
	@echo "⚠️  将用 $(FILE) 覆盖数据库，5秒后继续..."
	@sleep 5
	$(DOCKER_COMPOSE_DEV) exec -T db psql -U $${POSTGRES_USER:-user} -d $${POSTGRES_DB:-prometheus_db} < $(FILE)
	@echo "✅ 数据库恢复完成"

# ============================================================
# Version / 诊断
# ============================================================
.PHONY: doctor
doctor: ## 诊断本地环境依赖和配置
	@echo "🔍 环境诊断..."
	@echo ""
	@echo "--- 基础工具 ---"
	@command -v docker >/dev/null 2>&1 && echo "✅ docker:     $$(docker --version 2>&1)" || echo "❌ docker: 未安装"
	@command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 && echo "✅ compose:    $$(docker compose version 2>&1)" || echo "❌ docker compose: 不可用"
	@command -v python >/dev/null 2>&1 && echo "✅ python:     $$(python --version 2>&1)" || echo "❌ python: 未安装"
	@command -v node >/dev/null 2>&1 && echo "✅ node:       $$(node --version 2>&1)" || echo "⚠️  node: 未安装（仅前端需要）"
	@command -v npm >/dev/null 2>&1 && echo "✅ npm:        $$(npm --version 2>&1)" || true
	@command -v pre-commit >/dev/null 2>&1 && echo "✅ pre-commit: $$(pre-commit --version 2>&1)" || echo "⚠️  pre-commit: 未安装（运行 make setup 安装）"
	@echo ""
	@echo "--- 配置文件 ---"
	@for f in .env .env.example docker-compose.yml docker-compose.override.yml docker-compose.prod.yml Makefile .pre-commit-config.yaml; do \
		if [ -f "$$f" ]; then \
			echo "✅ $$f"; \
		else \
			echo "❌ $$f  缺失!"; \
		fi; \
	done
	@echo ""
	@echo "--- .env 关键变量检查 ---"
	@if [ -f .env ]; then \
		grep -E "^(JWT_SECRET|DATABASE_URL|POSTGRES_PASSWORD)=" .env | head -5 | sed 's/=.*/= ***已设置***/'; \
		grep -q "your-secret-key" .env && echo "⚠️  警告: JWT_SECRET 仍为默认值，请修改！" || true; \
	else \
		echo "⚠️  .env 不存在，运行 'make env-check' 创建"; \
	fi
	@echo ""
	@echo "✅ 诊断完成"

.PHONY: version
version: ## 显示项目组件版本
	@echo "HiveOps Version 1.0.0"
	@cd backend && [ -f requirements.txt ] && echo "--- Python deps (top-level) ---" && grep -v "^#" requirements.txt || true
	@cd frontend && [ -f package.json ] && echo "--- Node deps (top-level) ---" && node -p "Object.entries(require('./package.json').dependencies).map(([k,v])=>k+'@'+v).join('\n')" 2>/dev/null || true
