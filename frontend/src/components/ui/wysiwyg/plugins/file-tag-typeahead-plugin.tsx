import { useState, useCallback, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
} from '@lexical/react/LexicalTypeaheadMenuPlugin';
import { $createTextNode } from 'lexical';
import { Tag as TagIcon, FileText } from 'lucide-react';
import {
  searchTagsAndFiles,
  type SearchResultItem,
} from '@/lib/searchTagsAndFiles';

class FileTagOption extends MenuOption {
  item: SearchResultItem;

  constructor(item: SearchResultItem) {
    const key =
      item.type === 'tag' ? `tag-${item.tag!.id}` : `file-${item.file!.path}`;
    super(key);
    this.item = item;
  }
}

const MAX_DIALOG_HEIGHT = 320;
const VIEWPORT_MARGIN = 8;
const VERTICAL_GAP = 4;
const VERTICAL_GAP_ABOVE = 24;
const MIN_WIDTH = 320;
const MAX_HEIGHT_STABILITY_THRESHOLD = 10;

type MenuPlacement = ReturnType<typeof getMenuPosition>;

function getMenuPosition(
  anchorEl: HTMLElement,
  editorEl: HTMLElement | null
) {
  const rect = anchorEl.getBoundingClientRect();
  const editorRect = editorEl?.getBoundingClientRect();
  const viewportHeight = window.innerHeight;
  const viewportWidth = window.innerWidth;

  const topEdge = editorRect?.top ?? rect.top;
  const spaceAbove = topEdge;
  const spaceBelow = viewportHeight - rect.bottom;

  const showBelow = spaceBelow >= spaceAbove;

  const availableVerticalSpace = showBelow ? spaceBelow : spaceAbove;

  const maxHeight = Math.max(
    0,
    Math.min(MAX_DIALOG_HEIGHT, availableVerticalSpace - 2 * VIEWPORT_MARGIN)
  );

  let top: number | undefined;
  let bottom: number | undefined;

  if (showBelow) {
    top = rect.bottom + VERTICAL_GAP;
  } else {
    bottom = viewportHeight - topEdge + VERTICAL_GAP_ABOVE;
  }

  let left = rect.left;
  const maxLeft = viewportWidth - MIN_WIDTH - VIEWPORT_MARGIN;
  if (left > maxLeft) {
    left = Math.max(VIEWPORT_MARGIN, maxLeft);
  }

  return { top, bottom, left, maxHeight };
}

export function FileTagTypeaheadPlugin({ projectId }: { projectId?: string }) {
  const [editor] = useLexicalComposerContext();
  const [options, setOptions] = useState<FileTagOption[]>([]);
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const lastSelectedIndexRef = useRef<number>(-1);
  const lastPlacementRef = useRef<MenuPlacement | null>(null);

  const onQueryChange = useCallback(
    (query: string | null) => {
      // Lexical uses null to indicate "no active query / close menu"
      if (query === null) {
        setOptions([]);
        return;
      }

      // Here query is a string, including possible empty string ''
      searchTagsAndFiles(query, projectId)
        .then((results) => {
          setOptions(results.map((r) => new FileTagOption(r)));
        })
        .catch((err) => {
          console.error('Failed to search tags/files', err);
        });
    },
    [projectId]
  );

  return (
    <LexicalTypeaheadMenuPlugin<FileTagOption>
      triggerFn={(text) => {
        // Match @ followed by any non-whitespace characters
        const match = /(?:^|\s)@([^\s@]*)$/.exec(text);
        if (!match) return null;
        const offset = match.index + match[0].indexOf('@');
        return {
          leadOffset: offset,
          matchingString: match[1],
          replaceableString: match[0].slice(match[0].indexOf('@')),
        };
      }}
      options={options}
      onQueryChange={onQueryChange}
      onSelectOption={(option, nodeToReplace, closeMenu) => {
        editor.update(() => {
          const textToInsert =
            option.item.type === 'tag'
              ? (option.item.tag?.content ?? '')
              : (option.item.file?.path ?? '');

          if (!nodeToReplace) return;

          // Create the node we want to insert
          const textNode = $createTextNode(textToInsert);

          // Replace the trigger text (e.g., "@test") with selected content
          nodeToReplace.replace(textNode);

          // Move the cursor to the end of the inserted text
          textNode.select(textToInsert.length, textToInsert.length);
        });

        closeMenu();
      }}
      menuRenderFn={(
        anchorRef,
        { selectedIndex, selectOptionAndCleanUp, setHighlightedIndex }
      ) => {
        if (!anchorRef.current) return null;

        const nextPlacement = getMenuPosition(
          anchorRef.current,
          editor.getRootElement()
        );
        const previousPlacement = lastPlacementRef.current;
        const maxHeightStable =
          previousPlacement &&
          Math.abs(nextPlacement.maxHeight - previousPlacement.maxHeight) <
            MAX_HEIGHT_STABILITY_THRESHOLD;
        const placement = maxHeightStable
          ? { ...nextPlacement, maxHeight: previousPlacement.maxHeight }
          : nextPlacement;
        lastPlacementRef.current = placement;

        // Scroll selected item into view when navigating with arrow keys
        if (
          selectedIndex !== null &&
          selectedIndex !== lastSelectedIndexRef.current
        ) {
          lastSelectedIndexRef.current = selectedIndex;
          setTimeout(() => {
            const itemEl = itemRefs.current.get(selectedIndex);
            if (itemEl) {
              itemEl.scrollIntoView({ block: 'nearest' });
            }
          }, 0);
        }

        const tagResults = options.filter((r) => r.item.type === 'tag');
        const fileResults = options.filter((r) => r.item.type === 'file');

        const menuStyle = {
          top: placement.top,
          bottom: placement.bottom,
          left: placement.left,
          minWidth: MIN_WIDTH,
          zIndex: 10000,
          '--typeahead-menu-max-height': `${placement.maxHeight}px`,
        } as CSSProperties;

        return createPortal(
          <div
            className="fixed bg-background border border-border rounded-md shadow-lg overflow-hidden"
            style={menuStyle}
          >
            <div
              className="overflow-y-auto py-1"
              style={{ maxHeight: 'var(--typeahead-menu-max-height)' }}
            >
              {options.length === 0 ? (
                <div className="p-2 text-sm text-muted-foreground">
                  No tags or files found
                </div>
              ) : (
                <>
                {/* Tags Section */}
                {tagResults.length > 0 && (
                  <>
                    <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase">
                      Tags
                    </div>
                    {tagResults.map((option) => {
                      const index = options.indexOf(option);
                      const tag = option.item.tag!;
                      return (
                        <div
                          key={option.key}
                          ref={(el) => {
                            if (el) itemRefs.current.set(index, el);
                            else itemRefs.current.delete(index);
                          }}
                          className={`px-3 py-2 cursor-pointer text-sm ${
                            index === selectedIndex
                              ? 'bg-muted text-foreground'
                              : 'hover:bg-muted'
                          }`}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          onClick={() => selectOptionAndCleanUp(option)}
                        >
                          <div className="flex items-center gap-2 font-medium">
                            <TagIcon className="h-3.5 w-3.5 text-blue-600" />
                            <span>@{tag.tag_name}</span>
                          </div>
                          {tag.content && (
                            <div className="text-xs text-muted-foreground mt-0.5 truncate">
                              {tag.content.slice(0, 60)}
                              {tag.content.length > 60 ? '...' : ''}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </>
                )}

                {/* Files Section */}
                {fileResults.length > 0 && (
                  <>
                    {tagResults.length > 0 && <div className="border-t my-1" />}
                    <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase">
                      Files
                    </div>
                    {fileResults.map((option) => {
                      const index = options.indexOf(option);
                      const file = option.item.file!;
                      return (
                        <div
                          key={option.key}
                          ref={(el) => {
                            if (el) itemRefs.current.set(index, el);
                            else itemRefs.current.delete(index);
                          }}
                          className={`px-3 py-2 cursor-pointer text-sm ${
                            index === selectedIndex
                              ? 'bg-muted text-foreground'
                              : 'hover:bg-muted'
                          }`}
                          onMouseEnter={() => setHighlightedIndex(index)}
                          onClick={() => selectOptionAndCleanUp(option)}
                        >
                          <div className="flex items-center gap-2 font-medium truncate">
                            <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span>{file.name}</span>
                          </div>
                          <div className="text-xs text-muted-foreground truncate">
                            {file.path}
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
                </>
              )}
            </div>
          </div>,
          document.body
        );
      }}
    />
  );
}
