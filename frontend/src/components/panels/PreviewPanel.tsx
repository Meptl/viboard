import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useDevserverPreview } from '@/hooks/useDevserverPreview';
import { useDevServer } from '@/hooks/useDevServer';
import { useLogStream } from '@/hooks/useLogStream';
import { useDevserverUrlFromLogs } from '@/hooks/useDevserverUrl';
import { ClickToComponentListener } from '@/utils/previewBridge';
import { useClickedElements } from '@/contexts/ClickedElementsProvider';
import { Alert } from '@/components/ui/alert';
import { useProject } from '@/contexts/ProjectContext';
import { DevServerLogsView } from '@/components/tasks/TaskDetails/preview/DevServerLogsView';
import { PreviewToolbar } from '@/components/tasks/TaskDetails/preview/PreviewToolbar';
import { NoServerContent } from '@/components/tasks/TaskDetails/preview/NoServerContent';
import { ReadyContent } from '@/components/tasks/TaskDetails/preview/ReadyContent';

function normalizePreviewNavigationTarget(
  rawTarget: string,
  currentUrl?: string
): string | null {
  const target = rawTarget.trim();
  if (!target) {
    return null;
  }

  try {
    return new URL(target).toString();
  } catch {
    // Fall through to relative/host-only parsing.
  }

  if (currentUrl) {
    try {
      return new URL(target, currentUrl).toString();
    } catch {
      // Continue to host-only fallback.
    }
  }

  try {
    return new URL(`http://${target}`).toString();
  } catch {
    return null;
  }
}

export function PreviewPanel() {
  const [iframeError, setIframeError] = useState(false);
  const [hasIframeLoaded, setHasIframeLoaded] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showLogs, setShowLogs] = useState(false);
  const [iframeSrcUrl, setIframeSrcUrl] = useState<string>();
  const [previewDisplayUrl, setPreviewDisplayUrl] = useState<string>();
  const listenerRef = useRef<ClickToComponentListener | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hasAttemptedAutoStartRef = useRef(false);
  const autoExpandedNoUrlLogsProcessIdRef = useRef<string | null>(null);

  const { t } = useTranslation('tasks');
  const { project, projectId } = useProject();
  const { attemptId: rawAttemptId } = useParams<{ attemptId?: string }>();

  const attemptId =
    rawAttemptId && rawAttemptId !== 'latest' ? rawAttemptId : undefined;
  const projectHasDevScript = Boolean(project?.dev_script);

  const {
    start: startDevServer,
    stop: stopDevServer,
    isStarting: isStartingDevServer,
    isStopping: isStoppingDevServer,
    runningDevServer,
    latestDevServerProcess,
  } = useDevServer(attemptId);

  const logStream = useLogStream(latestDevServerProcess?.id ?? '');
  const lastKnownUrl = useDevserverUrlFromLogs(logStream.logs);

  const previewState = useDevserverPreview(attemptId, {
    projectHasDevScript,
    projectId: projectId!,
    lastKnownUrl,
  });

  useEffect(() => {
    setHasIframeLoaded(false);
    setShowHelp(false);
    setIframeError(false);
    setIframeSrcUrl(previewState.url);
    setPreviewDisplayUrl(previewState.url);
  }, [previewState.url]);

  const effectiveIframeSrcUrl = iframeSrcUrl ?? previewState.url;
  const effectivePreviewUrl = previewDisplayUrl ?? effectiveIframeSrcUrl;

  useEffect(() => {
    if (!effectiveIframeSrcUrl) {
      return;
    }

    let expectedOrigin: string | undefined;
    try {
      expectedOrigin = new URL(effectiveIframeSrcUrl).origin;
    } catch {
      expectedOrigin = undefined;
    }

    const handleMessage = (event: MessageEvent) => {
      if (!iframeRef.current?.contentWindow || event.source !== iframeRef.current.contentWindow) {
        return;
      }

      if (event.data?.type !== 'VIBE_IFRAME_NAVIGATION') {
        return;
      }

      const nextUrl = event.data?.payload?.url;
      if (typeof nextUrl !== 'string' || !nextUrl) {
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(nextUrl);
      } catch {
        return;
      }

      if (expectedOrigin && parsedUrl.origin !== expectedOrigin) {
        return;
      }

      const normalized = parsedUrl.toString();
      setPreviewDisplayUrl((prev) => (prev === normalized ? prev : normalized));
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [effectiveIframeSrcUrl]);

  const handleRefresh = () => {
    setIframeError(false);
    setHasIframeLoaded(false);
    setRefreshKey((prev) => prev + 1);
  };
  const handleIframeError = () => {
    setIframeError(true);
    setHasIframeLoaded(false);
  };

  const { addElement } = useClickedElements();

  const handleCopyUrl = async () => {
    if (effectivePreviewUrl) {
      await navigator.clipboard.writeText(effectivePreviewUrl);
    }
  };

  const handleNavigate = (target: string) => {
    const nextUrl = normalizePreviewNavigationTarget(target, effectivePreviewUrl);
    if (!nextUrl) {
      return;
    }
    setIframeError(false);
    setHasIframeLoaded(false);
    setIframeSrcUrl(nextUrl);
    setPreviewDisplayUrl(nextUrl);
  };

  const handleIframeLoad = (loadedUrl: string) => {
    setHasIframeLoaded(true);
    setShowHelp(false);
    setIframeSrcUrl((prev) => (prev === loadedUrl ? prev : loadedUrl));
    setPreviewDisplayUrl((prev) => (prev === loadedUrl ? prev : loadedUrl));
  };
  const handleIframeRef = useCallback((node: HTMLIFrameElement | null) => {
    iframeRef.current = node;
  }, []);

  useEffect(() => {
    if (previewState.status !== 'ready' || !previewState.url || !addElement) {
      return;
    }

    const listener = new ClickToComponentListener({
      onOpenInEditor: (payload) => {
        addElement(payload);
      },
      onReady: () => {
        setShowLogs(false);
        setShowHelp(false);
      },
    });

    listener.start();
    listenerRef.current = listener;

    return () => {
      listener.stop();
      listenerRef.current = null;
    };
  }, [previewState.status, previewState.url, addElement]);

  useEffect(() => {
    if (!runningDevServer || !latestDevServerProcess) {
      return;
    }

    if (hasIframeLoaded || iframeError) {
      return;
    }

    const timer = window.setTimeout(() => {
      setShowHelp(true);
      setShowLogs(true);
    }, 5000);

    return () => window.clearTimeout(timer);
  }, [
    hasIframeLoaded,
    iframeError,
    latestDevServerProcess,
    runningDevServer,
  ]);

  useEffect(() => {
    if (!latestDevServerProcess) {
      autoExpandedNoUrlLogsProcessIdRef.current = null;
      return;
    }

    if (lastKnownUrl || latestDevServerProcess.status === 'running') {
      return;
    }

    const hasAnyOutput =
      Boolean(logStream.error) || (logStream.logs?.length ?? 0) > 0;
    if (!hasAnyOutput) {
      return;
    }

    if (autoExpandedNoUrlLogsProcessIdRef.current === latestDevServerProcess.id) {
      return;
    }

    autoExpandedNoUrlLogsProcessIdRef.current = latestDevServerProcess.id;
    setShowLogs(true);
  }, [
    latestDevServerProcess,
    lastKnownUrl,
    logStream.error,
    logStream.logs,
  ]);

  const isPreviewReady =
    previewState.status === 'ready' &&
    Boolean(effectiveIframeSrcUrl) &&
    !iframeError;
  const mode = iframeError
    ? 'error'
    : isPreviewReady
      ? 'ready'
      : runningDevServer
        ? 'searching'
        : 'noServer';
  const toggleLogs = () => {
    setShowLogs((v) => !v);
  };

  const handleStartDevServer = useCallback(() => {
    setHasIframeLoaded(false);
    startDevServer();
    setShowHelp(false);
  }, [startDevServer]);

  const handleStopAndEdit = () => {
    stopDevServer(undefined, {
      onSuccess: () => {
        setShowHelp(false);
      },
    });
  };

  useEffect(() => {
    if (!attemptId) return;
    if (!projectHasDevScript) return;
    if (hasAttemptedAutoStartRef.current) return;
    if (runningDevServer || isStartingDevServer) return;

    hasAttemptedAutoStartRef.current = true;
    handleStartDevServer();
  }, [
    attemptId,
    projectHasDevScript,
    runningDevServer,
    isStartingDevServer,
    handleStartDevServer,
  ]);

  if (!attemptId) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center text-muted-foreground">
          <p className="text-lg font-medium">{t('preview.title')}</p>
          <p className="text-sm mt-2">{t('preview.selectAttempt')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className={`flex-1 flex flex-col min-h-0`}>
        {mode === 'ready' ? (
          <>
            <PreviewToolbar
              mode={mode}
              url={effectivePreviewUrl}
              onRefresh={handleRefresh}
              onCopyUrl={handleCopyUrl}
              onStop={stopDevServer}
              onNavigate={handleNavigate}
              isStopping={isStoppingDevServer}
            />
            <ReadyContent
              url={effectiveIframeSrcUrl}
              iframeKey={`${refreshKey}`}
              iframeRef={handleIframeRef}
              onIframeError={handleIframeError}
              onIframeLoad={handleIframeLoad}
            />
          </>
        ) : (
          <NoServerContent
            projectHasDevScript={projectHasDevScript}
            runningDevServer={runningDevServer}
            isStartingDevServer={isStartingDevServer}
            startDevServer={handleStartDevServer}
            stopDevServer={stopDevServer}
            project={project}
          />
        )}

        {showHelp && (
          <Alert variant="destructive" className="py-2">
            <div className="flex items-center justify-between gap-2">
              <p className="flex-1 text-sm">{t('preview.troubleAlert.title')}</p>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleStopAndEdit}
                disabled={isStoppingDevServer}
              >
                {isStoppingDevServer && (
                  <Loader2 className="mr-2 animate-spin" />
                )}
                {t('preview.noServer.stopAndEditButton')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowHelp(false)}
                className="h-6 w-6 p-0"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </Alert>
        )}
        <DevServerLogsView
          latestDevServerProcess={latestDevServerProcess}
          showLogs={showLogs}
          onToggle={toggleLogs}
          showToggleText
          logs={logStream.logs}
          error={logStream.error}
        />
      </div>
    </div>
  );
}
