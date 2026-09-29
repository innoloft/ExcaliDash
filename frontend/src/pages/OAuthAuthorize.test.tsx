import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthAuthorize } from "./OAuthAuthorize";
import * as api from "../api";

vi.mock("../components/Logo", () => ({ Logo: () => null }));

vi.mock("../api", () => ({
  getOAuthAuthorization: vi.fn(),
  decideOAuthAuthorization: vi.fn(),
  describeOAuthError: (_error: unknown, fallback: string) => fallback,
}));

const query = "?response_type=code&client_id=abc&redirect_uri=x&code_challenge=c&state=s";

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/oauth/authorize${query}`]}>
      <OAuthAuthorize />
    </MemoryRouter>,
  );

describe("OAuthAuthorize", () => {
  const assign = vi.fn();

  beforeEach(() => {
    vi.mocked(api.getOAuthAuthorization).mockResolvedValue({
      clientName: "Claude",
      redirectOrigin: "https://claude.ai",
      scopes: ["drawings:read", "drawings:write"],
      user: { name: "Ada", email: "ada@example.com" },
    });
    vi.stubGlobal("location", { ...window.location, assign });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows who is connecting and what it may do", async () => {
    renderPage();
    expect(await screen.findByText("Connect Claude")).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByText("Add and replace drawings")).toBeInTheDocument();
    expect(api.getOAuthAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "abc", state: "s" }),
    );
  });

  it("sends the approval and follows the redirect", async () => {
    vi.mocked(api.decideOAuthAuthorization).mockResolvedValue("https://claude.ai/cb?code=1");
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Allow" }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?code=1"));
    expect(api.decideOAuthAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "abc" }),
      "approve",
    );
  });

  it("explains invalid requests instead of offering consent", async () => {
    vi.mocked(api.getOAuthAuthorization).mockRejectedValue(new Error("bad"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("This connection request is invalid.");
    expect(screen.queryByRole("button", { name: "Allow" })).not.toBeInTheDocument();
  });
});
