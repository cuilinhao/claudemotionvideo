import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../src/lib/api";
import { DEFAULT_AUDIO_SETTINGS } from "../shared/audio";

const audio = {
  revision: 3,
  settings: DEFAULT_AUDIO_SETTINGS,
  musicAsset: null,
  voiceAsset: null,
};

afterEach(() => vi.unstubAllGlobals());

describe("audio API helpers", () => {
  it("loads and saves audio settings on the selected project", async () => {
    const fetchMock = vi.fn().mockImplementation(
      () => new Response(JSON.stringify(audio), {
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(api.projectAudio("project/a")).resolves.toEqual(audio);
    await api.saveProjectAudio("project/a", DEFAULT_AUDIO_SETTINGS);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/projects/project%2Fa/audio");
    expect(fetchMock.mock.calls[1][1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify(DEFAULT_AUDIO_SETTINGS),
    });
  });

  it("uploads audio with its project ID and creates voice with the supplied idempotency key", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ asset: { id: "asset-1" } }), {
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ asset: { id: "voice-1" }, cost: 20 }), {
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const file = new File(["audio"], "voice.mp3", { type: "audio/mpeg" });
    await api.uploadAudio("project-1", file);
    await api.generateVoice({
      projectId: "project-1",
      text: "Hello there.",
      voice: "nova",
      idempotencyKey: "voice-request-1",
    });

    const uploadBody = fetchMock.mock.calls[0][1]?.body as FormData;
    expect(uploadBody.get("projectId")).toBe("project-1");
    expect(uploadBody.get("file")).toBeInstanceOf(File);
    expect(fetchMock.mock.calls[1][0]).toBe("/api/projects/project-1/voice");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({
      text: "Hello there.",
      voice: "nova",
      idempotencyKey: "voice-request-1",
    });
  });

  it("preserves HTTP status and server error code for retry decisions", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Still generating.", code: "VOICE_IN_PROGRESS" }), {
          status: 409,
          headers: { "content-type": "application/json" },
        }),
      ),
    );

    await expect(api.generateVoice({
      projectId: "project-1",
      text: "Hello there.",
      voice: "alloy",
      idempotencyKey: "voice-request-1",
    })).rejects.toMatchObject({ status: 409, code: "VOICE_IN_PROGRESS" });
  });

  it("pins an MP4 save to the audio revision captured when export began", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ url: "/saved.mp4" }),
      { headers: { "content-type": "application/json" } },
    )));
    await api.saveMp4("project-1", "version-1", new Blob(["video"]), 7);
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(new Headers(init?.headers).get("X-Audio-Revision")).toBe("7");
    expect(new Headers(init?.headers).get("content-type")).toBe("video/mp4");
  });
});
