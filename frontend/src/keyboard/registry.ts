export enum Scope {
  GLOBAL = 'global',
  DIALOG = 'dialog',
  CONFIRMATION = 'confirmation',
  KANBAN = 'kanban',
  PROJECTS = 'projects',
  SETTINGS = 'settings',
  EDIT_COMMENT = 'edit-comment',
  APPROVALS = 'approvals',
  AGENT_CHAT = 'agent-chat',
}

export enum Action {
  EXIT = 'exit',
  CREATE = 'create',
  EDIT_TASK = 'edit_task',
  FOCUS_SEARCH = 'focus_search',
  SUBMIT_AGENT_CHAT = 'submit_agent_chat',
  SUBMIT_TASK = 'submit_task',
  SUBMIT_COMMENT = 'submit_comment',
  NEXT_NOTIFICATION = 'next_notification',
}

export interface KeyBinding {
  action: Action;
  keys: string | string[];
  scopes?: Scope[];
  description: string;
  group?: string;
}

export const keyBindings: KeyBinding[] = [
  // Exit/Close actions
  {
    action: Action.EXIT,
    keys: 'esc',
    scopes: [Scope.CONFIRMATION],
    description: 'Close confirmation dialog',
    group: 'Dialog',
  },
  {
    action: Action.EXIT,
    keys: 'esc',
    scopes: [Scope.DIALOG],
    description: 'Close dialog',
    group: 'Dialog',
  },
  {
    action: Action.EXIT,
    keys: 'esc',
    scopes: [Scope.KANBAN],
    description: 'Close panel or navigate to projects',
    group: 'Navigation',
  },
  {
    action: Action.EXIT,
    keys: 'esc',
    scopes: [Scope.EDIT_COMMENT],
    description: 'Cancel comment',
    group: 'Comments',
  },
  {
    action: Action.EXIT,
    keys: 'esc',
    scopes: [Scope.SETTINGS],
    description: 'Close settings',
    group: 'Navigation',
  },

  // Creation actions
  {
    action: Action.CREATE,
    keys: 'c',
    scopes: [Scope.KANBAN],
    description: 'Create new task',
    group: 'Kanban',
  },
  {
    action: Action.CREATE,
    keys: 'c',
    scopes: [Scope.PROJECTS],
    description: 'Create new project',
    group: 'Projects',
  },
  {
    action: Action.EDIT_TASK,
    keys: 'e',
    scopes: [Scope.KANBAN],
    description: 'Edit selected task',
    group: 'Kanban',
  },

  // Navigation actions
  {
    action: Action.FOCUS_SEARCH,
    keys: 'slash',
    scopes: [Scope.KANBAN],
    description: 'Focus search',
    group: 'Navigation',
  },
  {
    action: Action.NEXT_NOTIFICATION,
    keys: 'n',
    scopes: [Scope.KANBAN, Scope.PROJECTS],
    description: 'Open oldest unread notification',
    group: 'Navigation',
  },

  // Follow-up actions
  {
    action: Action.SUBMIT_AGENT_CHAT,
    keys: ['meta+enter', 'ctrl+enter'],
    scopes: [Scope.AGENT_CHAT],
    description: 'Send or queue follow-up (depending on state)',
    group: 'Follow-up',
  },
  {
    action: Action.SUBMIT_TASK,
    keys: ['meta+enter', 'ctrl+enter'],
    scopes: [Scope.DIALOG],
    description: 'Submit task form (Create & Start or Update)',
    group: 'Dialog',
  },
  {
    action: Action.SUBMIT_COMMENT,
    keys: ['meta+enter', 'ctrl+enter'],
    scopes: [Scope.EDIT_COMMENT],
    description: 'Submit review comment',
    group: 'Comments',
  },
];

/**
 * Get keyboard bindings for a specific action and scope
 */
export function getKeysFor(action: Action, scope?: Scope): string[] {
  const bindings = keyBindings
    .filter(
      (binding) =>
        binding.action === action &&
        (!scope || !binding.scopes || binding.scopes.includes(scope))
    )
    .flatMap((binding) =>
      Array.isArray(binding.keys) ? binding.keys : [binding.keys]
    );

  return bindings;
}

/**
 * Get binding info for a specific action and scope
 */
export function getBindingFor(
  action: Action,
  scope?: Scope
): KeyBinding | undefined {
  return keyBindings.find(
    (binding) =>
      binding.action === action &&
      (!scope || !binding.scopes || binding.scopes.includes(scope))
  );
}
