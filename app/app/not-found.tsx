import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, EmptyState } from "@/components/ui/primitives";
import { routes } from "@/lib/routes";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl py-16">
      <Card>
        <EmptyState
          icon={<SearchX />}
          title="Not in the compute set"
          description="That market or page is not covered. It may have fallen below the coverage floor, or the address may be wrong."
          action={
            <div className="flex gap-2">
              <Button asChild variant="primary" size="sm">
                <Link href={routes.assets}>Browse assets</Link>
              </Button>
              <Button asChild variant="secondary" size="sm">
                <Link href={routes.overview}>Overview</Link>
              </Button>
            </div>
          }
        />
      </Card>
    </div>
  );
}
