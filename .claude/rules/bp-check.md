---
description: Enforce BP best practices check before configuration work
globs: ["CLAUDE.md", ".claude/**", "Dockerfile*", "docker-compose*", "biome.*", "turbo.json", "pnpm-workspace.yaml", "vitest.config.*", "playwright.config.*", "jest.config.*", ".github/**"]
alwaysApply: false
---

# RULE 3 Enforcement: Check BP Before Configuration Work

Before creating or modifying infrastructure, tooling, or configuration files, consult the BP knowledge base for proven patterns.

## Required Steps

1. Fetch https://raw.githubusercontent.com/wellforce-brandon/BP/main/llms.txt
2. Identify relevant concerns from the file you're about to write
3. Fetch the relevant concern index
4. Read all FOUNDATIONAL entries and RECOMMENDED entries matching this project's tech tags
