# Packages, Extensions, Skills, Prompts, and Themes

This document describes the current Pi GUI React/Tauri implementation. Pi remains the package manager and runtime policy owner.

## Package operations

The Packages panel delegates these operations to Pi through typed Rust commands:

- list user packages;
- list project packages after explicit workspace trust;
- install a package in user or project scope;
- remove the exact listed source from its scope;
- update extensions.

Pi GUI does not implement npm/git installation itself and does not rewrite Pi's package settings. Mutations are serialized, output is capped, execution times out, and owned children are stopped when the app closes.

Local install sources must resolve inside the selected workspace. Option-like sources and arbitrary Pi arguments are rejected.

## Project trust

Project package configuration is hidden by default. The user must explicitly approve reading it, and every project-scoped install/remove/update warning explains that Pi packages can execute with full system access.

Approval lets Pi apply its own project package rules; it is not a sandbox. Only use packages and workspaces you trust.

## Runtime resources

A ready session calls Pi RPC `get_commands`. Pi GUI normalizes real `sourceInfo` and groups invokable:

- extensions/plugins;
- skills;
- prompt templates.

Clicking **Use** stages `/<command>` in the composer with a trailing space. It never executes automatically. Built-in TUI-only commands are absent when Pi does not expose them through RPC.

Pi GUI currently does not provide extension custom UI handling or package-specific configuration forms.

## Themes

The panel lists:

- Pi built-in `dark` and `light`;
- direct user themes;
- direct project themes after the workspace is selected.

Package-owned themes remain represented and managed by their package. Pi GUI does not ship a recommendation gallery, install bundled themes, activate a Pi theme, or duplicate `pi config`.

## Deliberate omissions

The current core has no curated marketplace, package search service, popularity ranking, automatic recommendations, default package auto-install, or desktop-owned package policy. Those inherited Gustav concepts are not part of Pi GUI `0.1.0`.

For implementation constraints, see `docs/PACKAGE_CAPABILITY_TEMPLATE.md` and `docs/PERMISSIONS.md`.
