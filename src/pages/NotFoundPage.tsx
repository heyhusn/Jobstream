import { Link } from "react-router-dom";

export function NotFoundPage() {
  return (
    <div className="grid min-h-screen place-items-center bg-paper px-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold">That page doesn't exist</h1>
        <Link to="/matches" className="mt-3 inline-block text-sm underline underline-offset-2">
          Back to your matches
        </Link>
      </div>
    </div>
  );
}
