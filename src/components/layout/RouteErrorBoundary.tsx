import { Component, type ReactNode } from "react";
import { ErrorState } from "@/components/ui/ErrorState";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Nothing in this app catches a render error — one throw anywhere in
 * the tree (e.g. the realtime-channel-reuse bug fixed alongside this)
 * unmounts everything, header included, to a blank white page with no
 * way back short of knowing to hit reload. A full reload is the only
 * reliable recovery here: whatever threw already corrupted this
 * render tree, and this app keeps no client-side state worth trying
 * to preserve across it.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error("Unhandled render error caught by RouteErrorBoundary:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="grid min-h-[50vh] place-items-center px-6">
          <ErrorState
            title="Something went wrong"
            body="This page hit an unexpected error. Reloading usually clears it."
            onRetry={() => window.location.reload()}
          />
        </div>
      );
    }
    return this.props.children;
  }
}
