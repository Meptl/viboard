# Codex Default Autonomy Policy

Codex default profiles run with danger-full-access sandboxing so tasks can execute autonomously without sandbox constraints.

The default, high, and max Codex variants in `crates/executors/default_profiles.json` set `sandbox` to `danger-full-access`. Documentation examples in `docs/configuration-customisation/agent-configurations.mdx` mirror this baseline.
