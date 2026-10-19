---
name: Agent task
about: A change small enough for one unattended agent run
title: ''
labels: ''
assignees: ''

---

<!-- Sizing (docs/agent-automation.md#sizing-an-issue): one layer, at most
about four modules, no measuring or deciding left to the agent. If an ADR,
upstream measurements, fixtures or new E2E baselines are needed, land them
first by hand.
Hand it over with the label agent:go once the prerequisites are merged. -->

## Change

What should be different afterwards, in one or two sentences.

## Files

The modules and tests this touches (at most about four).

## Done when

- [ ] The exact tests that prove it (names or behaviour)
- [ ] Docs / CHANGELOG entry if user-visible

## Out of scope

What the agent must not do in this issue (e.g. no network in tests, no new
ADR, no new dependency).

## Context

Links: ADR, upstream facts (HA attributes, Open-Meteo fields, with a source), previous slices ("N/M").
