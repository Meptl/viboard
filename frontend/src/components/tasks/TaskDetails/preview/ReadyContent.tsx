interface ReadyContentProps {
  url?: string;
  iframeKey: string;
  iframeRef?: (node: HTMLIFrameElement | null) => void;
  onIframeError: () => void;
  onIframeLoad?: (url: string) => void;
}

export function ReadyContent({
  url,
  iframeKey,
  iframeRef,
  onIframeError,
  onIframeLoad,
}: ReadyContentProps) {
  return (
    <div className="flex-1">
      <iframe
        ref={iframeRef}
        key={iframeKey}
        src={url}
        title="Dev server preview"
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        referrerPolicy="no-referrer"
        onError={onIframeError}
        onLoad={(e) => {
          const iframe = e.currentTarget;

          try {
            const loadedUrl = iframe.contentWindow?.location.href;
            if (loadedUrl) {
              onIframeLoad?.(loadedUrl);
              return;
            }
          } catch {
            // Cross-origin iframe, ignore and keep the last known URL.
          }

          if (iframe.src) {
            onIframeLoad?.(iframe.src);
          }
        }}
      />
    </div>
  );
}
