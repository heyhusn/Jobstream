import { Link } from "react-router-dom";
import { PublicHeader } from "@/components/layout/PublicHeader";

export function NotFoundPage() {
  return (
    <div className="min-h-screen bg-paper">
      <PublicHeader />
      <div className="grid min-h-[calc(100vh-62px)] place-items-center px-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">That page doesn't exist</h1>
          <Link to="/matches" className="mt-3 inline-block text-sm underline underline-offset-2">
            Back to your matches
          </Link>
        </div>
      </div>
    </div>
  );
}
