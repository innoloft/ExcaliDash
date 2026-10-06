import type { DrawingScene } from "./excalidrawScene";

export type Collection = {
  id: string;
  name: string;
  isOwner: boolean;
  sharedRole: string | null;
};

export type DrawingSummary = {
  id: string;
  name: string;
  collectionId: string | null;
  version: number;
  updatedAt: string;
};

export type DrawingListQuery = {
  collectionId?: string;
  search?: string;
  limit?: number;
};

export type CreateDrawingInput = DrawingScene & {
  name: string;
  collectionId: string | null;
};

export type ReplaceDrawingInput = DrawingScene & { name?: string };

export type DrawingDetail = DrawingSummary & DrawingScene;

/** The subset of the ExcaliDash REST API the MCP tools use. */
export interface ExcaliDashApi {
  listCollections(): Promise<Collection[]>;
  createCollection(name: string): Promise<Collection>;
  listDrawings(query: DrawingListQuery): Promise<DrawingSummary[]>;
  createDrawing(input: CreateDrawingInput): Promise<DrawingSummary>;
  replaceDrawing(
    id: string,
    input: ReplaceDrawingInput,
  ): Promise<DrawingSummary>;
  getDrawing(id: string): Promise<DrawingDetail>;
  /** Write `elements` only if the drawing is still at `version` (else 409). */
  updateElements(
    id: string,
    elements: unknown[],
    version: number,
  ): Promise<DrawingSummary>;
}

export class ExcaliDashApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ExcaliDashApiError";
  }
}

const describeFailure = (status: number, body: unknown): string => {
  if (body && typeof body === "object") {
    const { message, error } = body as { message?: unknown; error?: unknown };
    const parts = [error, message].filter(
      (part) => typeof part === "string" && part.length > 0,
    );
    if (parts.length > 0) return `${status}: ${parts.join(" — ")}`;
  }
  if (status === 401) return "401: API key is invalid or revoked";
  if (status === 413)
    return "413: Drawing is larger than the server's body limit";
  return `${status}: Request failed`;
};

const toSummary = (raw: any): DrawingSummary => ({
  id: raw.id,
  name: raw.name,
  collectionId: raw.collectionId ?? null,
  version: raw.version,
  updatedAt: raw.updatedAt,
});

export type ApiClientOptions = {
  /** Base URL the REST routes are served from, without trailing slash. */
  baseUrl: string;
  /** The caller's API key; null when auth is disabled (bootstrap mode). */
  apiKey: string | null;
  headers?: Record<string, string>;
};

/**
 * Calls the ExcaliDash REST API as the MCP caller. Going through the public
 * routes (rather than Prisma) keeps validation, sanitization, sharing rules,
 * API key scopes and collaboration broadcasts in one place.
 */
export class ExcaliDashClient implements ExcaliDashApi {
  constructor(private readonly options: ApiClientOptions) {}

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
  ): Promise<T> {
    // API keys bypass CSRF only for non-browser requests, i.e. without an
    // Origin or Referer header — never add either here.
    const response = await fetch(`${this.options.baseUrl}${path}`, {
      method,
      headers: {
        ...this.options.headers,
        ...(this.options.apiKey
          ? { Authorization: `Bearer ${this.options.apiKey}` }
          : {}),
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      parsed = undefined;
    }
    if (!response.ok) {
      throw new ExcaliDashApiError(
        response.status,
        describeFailure(response.status, parsed),
      );
    }
    if (parsed === undefined) {
      throw new ExcaliDashApiError(
        response.status,
        `Unexpected non-JSON response from ${path}`,
      );
    }
    return parsed as T;
  }

  async listCollections(): Promise<Collection[]> {
    const raw = await this.request<any[]>("GET", "/collections");
    return raw.map((c) => ({
      id: c.id,
      name: c.name,
      isOwner: Boolean(c.isOwner),
      sharedRole: c.sharedRole ?? null,
    }));
  }

  async createCollection(name: string): Promise<Collection> {
    const c = await this.request<any>("POST", "/collections", { name });
    return { id: c.id, name: c.name, isOwner: true, sharedRole: null };
  }

  async listDrawings(query: DrawingListQuery): Promise<DrawingSummary[]> {
    const params = new URLSearchParams();
    if (query.collectionId) params.set("collectionId", query.collectionId);
    if (query.search) params.set("search", query.search);
    params.set("limit", String(query.limit ?? 50));
    params.set("sortField", "updatedAt");
    const raw = await this.request<{ drawings: any[] }>(
      "GET",
      `/drawings?${params}`,
    );
    return raw.drawings.map(toSummary);
  }

  async createDrawing(input: CreateDrawingInput): Promise<DrawingSummary> {
    // Same payload shape and import header as the dashboard's file import.
    // The preview is left empty; the dashboard renders one on first view.
    const raw = await this.request<any>(
      "POST",
      "/drawings",
      { ...input, preview: null },
      { "X-Imported-File": "true" },
    );
    return toSummary(raw);
  }

  async replaceDrawing(
    id: string,
    input: ReplaceDrawingInput,
  ): Promise<DrawingSummary> {
    // `preview: null` drops the stale thumbnail so the dashboard regenerates it.
    const raw = await this.request<any>(
      "PUT",
      `/drawings/${encodeURIComponent(id)}`,
      {
        ...input,
        preview: null,
      },
    );
    return toSummary(raw);
  }

  async getDrawing(id: string): Promise<DrawingDetail> {
    const raw = await this.request<any>(
      "GET",
      `/drawings/${encodeURIComponent(id)}`,
    );
    return {
      ...toSummary(raw),
      elements: Array.isArray(raw.elements) ? raw.elements : [],
      appState: raw.appState ?? {},
      files: raw.files ?? {},
    };
  }

  async updateElements(
    id: string,
    elements: unknown[],
    version: number,
  ): Promise<DrawingSummary> {
    const raw = await this.request<any>(
      "PUT",
      `/drawings/${encodeURIComponent(id)}`,
      { elements, version, preview: null },
    );
    return toSummary(raw);
  }
}
