import { useMemo, useState } from 'react';
import { CircleHelp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Action, keyBindings, type KeyBinding } from '@/keyboard/registry';

interface DisplayBinding {
  description: string;
  keys: string[];
}

function formatKeyToken(token: string): string {
  const lower = token.toLowerCase();

  if (lower === 'meta') return 'Cmd';
  if (lower === 'ctrl') return 'Ctrl';
  if (lower === 'shift') return 'Shift';
  if (lower === 'alt') return 'Alt';
  if (lower === 'esc') return 'Esc';
  if (lower === 'enter') return 'Enter';
  if (lower === 'slash') return '/';

  return token.length === 1 ? token.toUpperCase() : token;
}

function formatKeyCombo(combo: string): string {
  return combo
    .split('+')
    .map((token) => formatKeyToken(token.trim()))
    .join(' + ');
}

function getBindingKeys(binding: KeyBinding): string[] {
  const keys = Array.isArray(binding.keys) ? binding.keys : [binding.keys];
  return keys.map(formatKeyCombo);
}

const GENERIC_SUBMIT_ACTIONS = new Set<Action>([
  Action.SUBMIT_AGENT_CHAT,
  Action.SUBMIT_TASK,
  Action.SUBMIT_COMMENT,
]);

export function KeyboardShortcutsHelp() {
  const [open, setOpen] = useState(false);

  const displayBindings = useMemo<DisplayBinding[]>(() => {
    const bindings: DisplayBinding[] = [];

    const addBinding = (binding: DisplayBinding) => {
      const exists = bindings.some(
        (entry) =>
          entry.description === binding.description &&
          entry.keys.join(' | ') === binding.keys.join(' | ')
      );
      if (!exists) bindings.push(binding);
    };

    addBinding({
      description: 'Close',
      keys: ['Esc'],
    });
    addBinding({
      description: 'Create task/project',
      keys: ['C'],
    });
    addBinding({
      description: 'Submit',
      keys: ['Cmd + Enter', 'Ctrl + Enter'],
    });
    addBinding({
      description: 'Find on page',
      keys: ['Cmd + F', 'Ctrl + F'],
    });
    addBinding({
      description: 'Duplicate task by dragging',
      keys: ['Shift + Drag'],
    });

    keyBindings.forEach((binding) => {
      if (binding.action === Action.EXIT || binding.action === Action.CREATE) {
        return;
      }
      if (GENERIC_SUBMIT_ACTIONS.has(binding.action)) {
        return;
      }
      addBinding({
        description: binding.description,
        keys: getBindingKeys(binding),
      });
    });

    return bindings.sort((a, b) => a.description.localeCompare(b.description));
  }, []);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-9 w-9"
        aria-label="Keyboard shortcuts"
        onClick={() => setOpen(true)}
      >
        <CircleHelp className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>
              Quick reference for commonly used keybindings.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[60vh] overflow-y-auto pr-1 space-y-1.5">
            {displayBindings.map((binding) => {
              const bindingId = `${binding.description}`;

              return (
                <div
                  key={bindingId}
                  className="flex items-start justify-between gap-3 rounded-md border border-border/60 px-3 py-2"
                >
                  <span className="text-sm text-muted-foreground">
                    {binding.description}
                  </span>
                  <div className="flex flex-wrap items-center justify-end gap-1.5 shrink-0">
                    {binding.keys.map((combo) => (
                      <kbd
                        key={`${bindingId}-${combo}`}
                        className="rounded border bg-muted px-1.5 py-0.5 text-xs font-medium text-foreground"
                      >
                        {combo}
                      </kbd>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
