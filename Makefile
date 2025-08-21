SHELL := /bin/bash

FRONTEND_DIR := frontend
BACKEND_DIR  := server
TMUX_SESSION := sttapp
FRONTEND_PORT := 5173
BACKEND_PORT  := 8000

PY_CANDIDATES := python3.13 python3 python
PY := $(firstword $(foreach p,$(PY_CANDIDATES),$(if $(shell command -v $(p) 2>/dev/null),$(p),)))
VENV_DIR := $(BACKEND_DIR)/.venv
VENV_PY  := $(VENV_DIR)/bin/python
VENV_BIN := $(VENV_DIR)/bin
HAS_UV   := $(shell command -v uv >/dev/null 2>&1 && echo yes || echo no)

define RUN_IN_VENV
cd $(BACKEND_DIR) && . $(VENV_BIN)/activate 2>/dev/null || true; $(1)
endef

.PHONY: help
help:
	@echo "Targets:"
	@echo "  make setup       - venv + deps (python & yarn) + pre-commit hook + start tmux"
	@echo "  make dev         - start backend|frontend i två tmux-rutor"
	@echo "  make backend     - endast backend"
	@echo "  make frontend    - endast frontend"
	@echo "  make lint        - ruff + mypy"
	@echo "  make format      - black + ruff --fix"
	@echo "  make test        - pytest"

.PHONY: setup
setup: venv python-deps frontend-deps install-hooks dev

.PHONY: venv
venv:
	@if [ ! -d "$(VENV_DIR)" ]; then \
		echo ">> Skapar venv i $(VENV_DIR) med $(PY)"; \
		if [ "$(HAS_UV)" = "yes" ]; then uv venv --python $(PY) $(VENV_DIR); else $(PY) -m venv $(VENV_DIR); fi; \
	else echo ">> Venv finns redan: $(VENV_DIR)"; fi

.PHONY: python-deps
python-deps: venv
	@echo ">> Installerar Python-deps i venv"
	@if [ "$(HAS_UV)" = "yes" ]; then \
		uv pip install -r $(BACKEND_DIR)/requirements.txt -r $(BACKEND_DIR)/requirements-dev.txt -p $(VENV_PY); \
	else \
		$(VENV_PY) -m pip --version >/dev/null 2>&1 || ($(VENV_PY) -m ensurepip --upgrade); \
		$(VENV_PY) -m pip install --upgrade pip setuptools wheel; \
		$(VENV_PY) -m pip install -r $(BACKEND_DIR)/requirements.txt -r $(BACKEND_DIR)/requirements-dev.txt; \
	fi

.PHONY: frontend-deps
frontend-deps:
	@echo ">> Installerar frontend-deps (yarn)"
	cd $(FRONTEND_DIR) && yarn install

.PHONY: install-hooks
install-hooks:
	@echo ">> Säkerställer git-repo och installerar pre-commit-hook"
	@if [ ! -d .git ]; then git init && git add . && git commit -m "init" || true; fi
	@mkdir -p .git/hooks
	@printf '#!/usr/bin/env bash\nset -euo pipefail\nROOT="$$(git rev-parse --show-toplevel)"\nexec "$$ROOT/$(BACKEND_DIR)/.venv/bin/pre-commit" run --hook-stage pre-commit\n' > .git/hooks/pre-commit
	@chmod +x .git/hooks/pre-commit
	@echo "✓ Hook klar: .git/hooks/pre-commit"

.PHONY: dev
dev:
	@if ! command -v tmux >/dev/null 2>&1; then echo "tmux saknas. sudo apt install -y tmux"; exit 1; fi; \
	if tmux has-session -t $(TMUX_SESSION) 2>/dev/null; then tmux kill-session -t $(TMUX_SESSION) 2>/dev/null || true; fi; \
	tmux new-session -d -s $(TMUX_SESSION) -n app 'bash -lc "cd $(BACKEND_DIR) && . $(VENV_BIN)/activate 2>/dev/null || true; uvicorn main:app --reload --host 0.0.0.0 --port $(BACKEND_PORT); code=$$?; echo; echo \"[backend exited $$code]\"; read -p \"Enter för att stänga...\" _"'; \
	tmux split-window -t $(TMUX_SESSION):app -h 'bash -lc "cd $(FRONTEND_DIR) && yarn dev --port $(FRONTEND_PORT); code=$$?; echo; echo \"[frontend exited $$code]\"; read -p \"Enter för att stänga...\" _"'; \
	tmux select-layout -t $(TMUX_SESSION):app even-horizontal; \
	tmux attach -t $(TMUX_SESSION)

.PHONY: backend
backend:
	@$(call RUN_IN_VENV, uvicorn main:app --reload --host 0.0.0.0 --port $(BACKEND_PORT))

.PHONY: frontend
frontend:
	cd $(FRONTEND_DIR) && yarn dev --port $(FRONTEND_PORT)

.PHONY: lint
lint:
	@$(call RUN_IN_VENV, ruff check .)
	@$(call RUN_IN_VENV, mypy .)

.PHONY: format
format:
	@$(call RUN_IN_VENV, black .)
	@$(call RUN_IN_VENV, ruff check --fix .)

.PHONY: test
test:
	@$(call RUN_IN_VENV, pytest -q)
