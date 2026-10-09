import { coordinatedWireRoutes } from "./geometry.ts";
import type { CoordinatedWireInput, CoordinatedWireRoute, SchematicComponentLike } from "./geometry.ts";

export interface WireRouteRequest {
  requestId: number;
  wires: CoordinatedWireInput[];
  components: SchematicComponentLike[];
}

export interface WireRouteResponse {
  requestId: number;
  routes?: CoordinatedWireRoute[];
  error?: string;
}

export function calculateWireRoutes(request: WireRouteRequest): WireRouteResponse {
  try {
    return {
      requestId: request.requestId,
      routes: coordinatedWireRoutes(request.wires, request.components),
    };
  } catch (error) {
    return {
      requestId: request.requestId,
      error: error instanceof Error ? error.message : "Wire routing failed.",
    };
  }
}

export function isLatestWireRouteResponse(response: WireRouteResponse, latestRequestId: number): boolean {
  return response.requestId === latestRequestId;
}
