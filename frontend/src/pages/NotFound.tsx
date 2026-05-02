import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { paths } from '@/lib/paths';
import { useNavigate } from 'react-router-dom';

export function NotFound() {
  const navigate = useNavigate();

  return (
    <div className="h-full w-full flex items-center justify-center p-6">
      <Card className="w-full max-w-xl">
        <CardHeader>
          <CardTitle>404 - Page Not Found</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            The page you requested does not exist.
          </p>
          <Button onClick={() => navigate(paths.projects())}>
            Back to Projects
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
