import { useEffect } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { registerCodeHighlighting, $isCodeNode } from '@lexical/code';
import { $getRoot } from 'lexical';

export function CodeHighlightPlugin() {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const unregister = registerCodeHighlighting(editor);

    editor.update(() => {
      for (const node of $getRoot().getChildren()) {
        if ($isCodeNode(node)) {
          node.markDirty();
        }
      }
    });

    return unregister;
  }, [editor]);

  return null;
}
