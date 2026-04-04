# Project View Escape Shortcut

Pressing Escape in the project task board closes an open task panel first, then returns to the all-projects page when no panel is open.

This behavior is implemented in [[frontend/src/pages/ProjectTasks.tsx#ProjectTasks]] through the KANBAN `EXIT` shortcut, and aligns with the shortcut intent documented in [[frontend/src/keyboard/registry.ts#keyBindings]].
