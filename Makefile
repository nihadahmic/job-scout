.PHONY: run run-cached test lint format

run:
	uv run python -m collector

run-cached:
	uv run python -m collector --cache

test:
	uv run pytest -q

lint:
	uv run ruff check .
	uv run ruff format --check .

format:
	uv run ruff format .
	uv run ruff check --fix .
