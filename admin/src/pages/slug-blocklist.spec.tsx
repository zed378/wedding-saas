import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ApiClient } from "@wi/api-client";
import { SlugBlocklistPage } from "./SlugBlocklistPage.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const entry = {
  id: "one",
  term: "sample",
  match_type: "exact",
  category: "other",
  reason: "Support request",
};
function list() {
  return vi.spyOn(ApiClient.prototype, "get").mockResolvedValue({
    data: [entry],
    meta: { page: 1, per_page: 20, total: 1 },
  });
}
describe("P5-13 blocklist administration", () => {
  it("loads actual API data and paginated count", async () => {
    const get = list();
    render(<SlugBlocklistPage />);
    expect(
      await screen.findByRole("button", { name: "Pilih sample" }),
    ).toBeTruthy();
    expect(get).toHaveBeenCalledWith(
      "/api/v1/admin/slug-blocklist",
      expect.objectContaining({ query: { page: 1, per_page: 20 } }),
    );
    expect(screen.getByText("Halaman 1 · 1 kata")).toBeTruthy();
  });
  it("submits candidate and shows enforcement result", async () => {
    list();
    const post = vi.spyOn(ApiClient.prototype, "post").mockResolvedValue({
      data: { blocked: true, valid_format: true, matching_term: "bad" },
      meta: undefined,
    });
    render(<SlugBlocklistPage />);
    fireEvent.change(screen.getByLabelText("Calon slug", { exact: false }), {
      target: { value: "couple-b4d" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Periksa slug" }));
    expect(await screen.findByText("Diblokir oleh kata: bad")).toBeTruthy();
    expect(post).toHaveBeenCalledWith("/api/v1/admin/slug-blocklist/test", {
      slug: "couple-b4d",
    });
  });
  it("saves selected entry with mandatory reason and displays existing-match warning", async () => {
    list();
    const mutate = vi.spyOn(ApiClient.prototype, "request").mockResolvedValue({
      data: {
        existing_matches: [{ id: "inv", slug: "sample", status: "published" }],
        existing_match_count: 1,
      },
      meta: undefined,
    });
    render(<SlugBlocklistPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Pilih sample" }),
    );
    fireEvent.change(
      screen.getByLabelText("Alasan perubahan", { exact: false }),
      { target: { value: "Support review" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Simpan kata" }));
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith("/api/v1/admin/slug-blocklist/one", {
        method: "PATCH",
        body: {
          term: "sample",
          match_type: "exact",
          category: "other",
          reason: "Support review",
        },
      }),
    );
    expect(await screen.findByText(/1 slug cocok/)).toBeTruthy();
    expect(screen.getByText("sample — published")).toBeTruthy();
  });
  it("keeps the candidate and selected entry fixed while a check is pending", async () => {
    list();
    let finish!: (value: never) => void;
    vi.spyOn(ApiClient.prototype, "post").mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(<SlugBlocklistPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Pilih sample" }),
    );
    fireEvent.change(screen.getByLabelText("Calon slug", { exact: false }), {
      target: { value: "couple-safe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Periksa slug" }));
    expect(
      screen.getByLabelText("Calon slug", { exact: false }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pilih sample" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Batal" })).toBeDisabled();
    finish({
      data: { blocked: false, valid_format: true, matching_term: null },
    } as never);
    expect(await screen.findByText(/Lolos blocklist/)).toBeInTheDocument();
    expect(screen.getByLabelText("Calon slug", { exact: false })).toBeEnabled();
  });
  it("deletes only selected entry after a reason has been supplied", async () => {
    list();
    const mutate = vi
      .spyOn(ApiClient.prototype, "request")
      .mockResolvedValue({ data: { id: "one" }, meta: undefined });
    render(<SlugBlocklistPage />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Pilih sample" }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Hapus kata terpilih",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.change(
      screen.getByLabelText("Alasan perubahan", { exact: false }),
      { target: { value: "Remove obsolete term" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Hapus kata terpilih" }),
    );
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith("/api/v1/admin/slug-blocklist/one", {
        method: "DELETE",
        body: { reason: "Remove obsolete term" },
      }),
    );
  });
  it("shows load failure rather than fabricated entries", async () => {
    vi.spyOn(ApiClient.prototype, "get").mockRejectedValue(
      new Error("offline"),
    );
    render(<SlugBlocklistPage />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Pilih sample" })).toBeNull();
  });

  it("clears the previous page when loading the next page fails", async () => {
    vi.spyOn(ApiClient.prototype, "get")
      .mockResolvedValueOnce({
        data: [entry],
        meta: { page: 1, per_page: 20, total: 21 },
      })
      .mockRejectedValueOnce(new Error("offline"));
    render(<SlugBlocklistPage />);
    await screen.findByRole("button", { name: "Pilih sample" });
    fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
    await screen.findByRole("alert");
    expect(screen.queryByRole("button", { name: "Pilih sample" })).toBeNull();
  });

  it("returns to the last remaining page after deleting its final entry", async () => {
    const get = vi
      .spyOn(ApiClient.prototype, "get")
      .mockResolvedValueOnce({
        data: [entry],
        meta: { page: 1, per_page: 20, total: 21 },
      })
      .mockResolvedValueOnce({
        data: [entry],
        meta: { page: 2, per_page: 20, total: 21 },
      })
      .mockResolvedValueOnce({
        data: [],
        meta: { page: 2, per_page: 20, total: 20 },
      })
      .mockResolvedValue({
        data: [entry],
        meta: { page: 1, per_page: 20, total: 20 },
      });
    vi.spyOn(ApiClient.prototype, "request").mockResolvedValue({
      data: { id: "one" },
      meta: undefined,
    });
    render(<SlugBlocklistPage />);
    await screen.findByRole("button", { name: "Pilih sample" });
    fireEvent.click(screen.getByRole("button", { name: "Berikutnya" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    fireEvent.click(
      await screen.findByRole("button", { name: "Pilih sample" }),
    );
    fireEvent.change(
      screen.getByLabelText("Alasan perubahan", { exact: false }),
      {
        target: { value: "Remove obsolete term" },
      },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Hapus kata terpilih" }),
    );
    await waitFor(() => expect(get).toHaveBeenCalledTimes(4));
    expect(get).toHaveBeenLastCalledWith(
      "/api/v1/admin/slug-blocklist",
      expect.objectContaining({ query: { page: 1, per_page: 20 } }),
    );
  });
});
