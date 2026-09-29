import { api, isAxiosError } from "./client";

export type OAuthAuthorizationDetails = {
  clientName: string;
  redirectOrigin: string;
  scopes: string[];
  user: { name: string; email: string };
};

export const describeOAuthError = (error: unknown, fallback: string): string => {
  if (isAxiosError(error)) {
    const data = error.response?.data as { error_description?: string; message?: string } | undefined;
    return data?.error_description || data?.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
};

/** Validate the connector's authorization request and fetch what to show. */
export const getOAuthAuthorization = async (
  params: Record<string, string>,
): Promise<OAuthAuthorizationDetails> => {
  const response = await api.get<OAuthAuthorizationDetails>("/oauth/authorize", { params });
  return response.data;
};

/** Record the user's decision; resolves to where the browser goes next. */
export const decideOAuthAuthorization = async (
  params: Record<string, string>,
  decision: "approve" | "deny",
): Promise<string> => {
  const response = await api.post<{ redirectTo: string }>("/oauth/authorize", { ...params, decision });
  return response.data.redirectTo;
};
