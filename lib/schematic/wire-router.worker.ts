import { calculateWireRoutes, type WireRouteRequest } from "./route-worker-core.ts";

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WireRouteRequest>) => void) | null;
  postMessage: (message: ReturnType<typeof calculateWireRoutes>) => void;
};

workerScope.onmessage = (event) => {
  workerScope.postMessage(calculateWireRoutes(event.data));
};
