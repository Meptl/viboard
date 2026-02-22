import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  PASTE_COMMAND,
  COMMAND_PRIORITY_LOW,
  $getSelection,
  $isRangeSelection,
  $getRoot,
  $isElementNode,
} from 'lexical';
import {
  $convertFromMarkdownString,
  type Transformer,
} from '@lexical/markdown';

type Props = {
  transformers: Transformer[];
};

/**
 * Converts pasted plain text as markdown while preserving rich-HTML paste behavior.
 */
export function PasteMarkdownPlugin({ transformers }: Props) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent)) return false;

        const clipboardData = event.clipboardData;
        if (!clipboardData) return false;

        // If HTML exists in clipboard, let Lexical handle rich content.
        if (clipboardData.getData('text/html')) return false;

        const plainText = clipboardData.getData('text/plain');
        if (!plainText) return false;

        event.preventDefault();

        editor.update(() => {
          const selection = $getSelection();

          if ($isRangeSelection(selection) && !selection.isCollapsed()) {
            selection.removeText();
          }

          const anchorNode = selection?.getNodes()?.[0];
          const topLevel = anchorNode?.getTopLevelElement?.();
          const targetElement =
            topLevel && $isElementNode(topLevel) ? topLevel : $getRoot();

          $convertFromMarkdownString(plainText, transformers, targetElement);
        });

        return true;
      },
      COMMAND_PRIORITY_LOW
    );
  }, [editor, transformers]);

  return null;
}
