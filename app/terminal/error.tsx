"use client";

import * as React from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-xl py-16">
      <Card>
        <EmptyState
          icon={<AlertTriangle />}
          title="This view failed to compute"
          description="Something went wrong rendering this page. Retrying re-runs the computation for this view only."
          action={
            <Button variant="secondary" size="sm" onClick={reset}>
              Retry
            </Button>
          }
        />
        {error.digest ? (
          <p className="pb-6 text-center font-mono text-[11px] text-faint">
            digest {error.digest}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
