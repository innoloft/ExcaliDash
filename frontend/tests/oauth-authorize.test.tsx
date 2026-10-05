import { MemoryRouter } from "react-router-dom";
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer,
} from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OAuthAuthorize } from "../src/pages/OAuthAuthorize";
import * as api from "../src/api";
import { waitFor } from "./renderHook";

vi.mock("../src/components/Logo", () => ({ Logo: () => null }));

vi.mock("../src/api", () => ({
  getOAuthAuthorization: vi.fn(),
  decideOAuthAuthorization: vi.fn(),
  describeOAuthError: (_error: unknown, fallback: string) => fallback,
}));

const query =
  "?response_type=code&client_id=abc&redirect_uri=x&code_challenge=c&state=s";

let renderer: ReactTestRenderer | undefined;

const renderPage = async () => {
  await act(async () => {
    renderer = create(
      <MemoryRouter initialEntries={[`/oauth/authorize${query}`]}>
        <OAuthAuthorize />
      </MemoryRouter>,
    );
  });
  return renderer!;
};

const textOf = (node: ReactTestInstance | string): string =>
  typeof node === "string" ? node : node.children.map(textOf).join("");

const hostNodes = () =>
  renderer!.root.findAll((node) => typeof node.type === "string");

const hasText = (text: string) =>
  hostNodes().some((node) => textOf(node) === text);

const button = (label: string) =>
  hostNodes().find((node) => node.type === "button" && textOf(node) === label);

const alert = () => hostNodes().find((node) => node.props.role === "alert");

describe("OAuthAuthorize", () => {
  const assign = vi.fn();

  beforeEach(() => {
    vi.mocked(api.getOAuthAuthorization).mockResolvedValue({
      clientName: "Claude",
      redirectOrigin: "https://claude.ai",
      scopes: ["drawings:read", "drawings:write"],
      user: { name: "Ada", email: "ada@example.com" },
    });
    vi.stubGlobal("window", { location: { assign } });
  });

  afterEach(async () => {
    await act(async () => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("shows who is connecting and what it may do", async () => {
    await renderPage();
    await waitFor(() => expect(hasText("Connect Claude")).toBe(true));
    expect(hasText("ada@example.com")).toBe(true);
    expect(hasText("Add and replace drawings")).toBe(true);
    expect(api.getOAuthAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "abc", state: "s" }),
    );
  });

  it("sends the approval and follows the redirect", async () => {
    vi.mocked(api.decideOAuthAuthorization).mockResolvedValue(
      "https://claude.ai/cb?code=1",
    );
    await renderPage();
    await waitFor(() => expect(button("Allow")).toBeDefined());
    await act(async () => button("Allow")!.props.onClick());
    await waitFor(() =>
      expect(assign).toHaveBeenCalledWith("https://claude.ai/cb?code=1"),
    );
    expect(api.decideOAuthAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({ client_id: "abc" }),
      "approve",
    );
  });

  it("explains invalid requests instead of offering consent", async () => {
    vi.mocked(api.getOAuthAuthorization).mockRejectedValue(new Error("bad"));
    await renderPage();
    await waitFor(() => expect(alert()).toBeDefined());
    expect(textOf(alert()!)).toBe("This connection request is invalid.");
    expect(button("Allow")).toBeUndefined();
  });
});
