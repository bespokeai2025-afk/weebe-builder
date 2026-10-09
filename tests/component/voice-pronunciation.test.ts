import { describe, expect, it } from "vitest";
import {
  applyPronunciationDictionary,
  applyPronunciationDictionaryStream,
  ipaToCmu,
  renderPronunciation,
  unsupportedPronunciationEntries,
  validatePronunciationEntry,
  type PronunciationEntry,
} from "@/lib/voice/tts/pronunciation-dictionary.shared";

const fish = { provider: "fish" };
const cartesia = { provider: "cartesia" };

async function collect(chunks: string[], entries: PronunciationEntry[], target = fish) {
  async function* src() {
    for (const c of chunks) yield c;
  }
  const out: string[] = [];
  for await (const piece of applyPronunciationDictionaryStream(src(), entries, target)) out.push(piece);
  return out;
}

describe("renderPronunciation", () => {
  it("passes sounds-like text through on every voice", () => {
    const e: PronunciationEntry = { word: "Xero", alphabet: "respell", phoneme: "ZEER-oh" };
    for (const provider of ["fish", "cartesia", "openai"]) {
      expect(renderPronunciation(e, { provider })).toBe("ZEER-oh");
    }
  });

  it("wraps CMU in Fish phoneme tags and normalises case/spacing", () => {
    const e: PronunciationEntry = { word: "Siobhan", alphabet: "cmu", phoneme: "sh ah0  v ao1 n" };
    expect(renderPronunciation(e, fish)).toBe("<|phoneme_start|>SH AH0 V AO1 N<|phoneme_end|>");
  });

  it("converts IPA to CMU for Fish", () => {
    const e: PronunciationEntry = { word: "banana", alphabet: "ipa", phoneme: "bəˈnænə" };
    expect(renderPronunciation(e, fish)).toBe("<|phoneme_start|>B AH0 N AE1 N AH0<|phoneme_end|>");
  });

  it("writes Cartesia IPA with the stress mark as its own segment", () => {
    const e: PronunciationEntry = { word: "banana", alphabet: "ipa", phoneme: "/bəˈnænə/" };
    expect(renderPronunciation(e, cartesia)).toBe("<<b|ə|n|ˈ|æ|n|ə>>");
  });

  it("converts CMU to IPA for Cartesia", () => {
    const e: PronunciationEntry = { word: "quick", alphabet: "cmu", phoneme: "K W IH1 K" };
    expect(renderPronunciation(e, cartesia)).toBe("<<k|w|ˈ|ɪ|k>>");
  });

  it("returns null for phonemes on a voice with no phoneme input, and for bad notation", () => {
    expect(renderPronunciation({ word: "a", alphabet: "ipa", phoneme: "ə" }, { provider: "openai" })).toBeNull();
    expect(renderPronunciation({ word: "a", alphabet: "cmu", phoneme: "QQ" }, fish)).toBeNull();
    expect(renderPronunciation({ word: "a", alphabet: "ipa", phoneme: "☃" }, cartesia)).toBeNull();
  });
});

describe("ipaToCmu", () => {
  it("marks unstressed vowels 0 once any stress is given, none otherwise", () => {
    expect(ipaToCmu("ˈhɛloʊ")).toBe("HH EH1 L OW0");
    expect(ipaToCmu("hɛloʊ")).toBe("HH EH L OW");
  });
  it("handles affricates and diphthongs", () => {
    expect(ipaToCmu("tʃɔɪ")).toBe("CH OY");
  });
});

describe("validatePronunciationEntry", () => {
  it("flags unknown IPA and malformed CMU, accepts sounds-like", () => {
    expect(validatePronunciationEntry({ word: "x", alphabet: "ipa", phoneme: "☃" })).toMatch(/IPA/);
    expect(validatePronunciationEntry({ word: "x", alphabet: "cmu", phoneme: "hello" })).toMatch(/CMU/);
    expect(validatePronunciationEntry({ word: "x", alphabet: "respell", phoneme: "ex" })).toBeNull();
  });
});

describe("applyPronunciationDictionary", () => {
  it("leaves words alone when their entry can't be spoken on the voice", () => {
    const entries: PronunciationEntry[] = [{ word: "Xero", alphabet: "ipa", phoneme: "ˈzɪəɹoʊ" }];
    expect(applyPronunciationDictionary("Use Xero", entries, { provider: "openai" })).toBe("Use Xero");
    expect(unsupportedPronunciationEntries(entries, { provider: "openai" })).toHaveLength(1);
  });

  it("matches phrases and possessives, and never re-matches a replacement", () => {
    const entries: PronunciationEntry[] = [
      { word: "New York", alphabet: "respell", phoneme: "noo YORK" },
      { word: "york", alphabet: "respell", phoneme: "yo-ork" },
      { word: "Xero", alphabet: "cmu", phoneme: "Z IH1 R OW0" },
    ];
    expect(applyPronunciationDictionary("In new  york, Xero's team", entries, fish)).toBe(
      "In noo YORK, <|phoneme_start|>Z IH1 R OW0<|phoneme_end|>'s team",
    );
  });

  it("treats `$` in the replacement literally", () => {
    expect(
      applyPronunciationDictionary("pay", [{ word: "pay", alphabet: "respell", phoneme: "$& pay" }], fish),
    ).toBe("$& pay");
  });
});

describe("applyPronunciationDictionaryStream", () => {
  const xero: PronunciationEntry = { word: "Xero", alphabet: "respell", phoneme: "ZEER-oh" };

  it("passes the stream through untouched when there is nothing to apply", async () => {
    expect(await collect(["Hel", "lo ", "there"], [])).toEqual(["Hel", "lo ", "there"]);
  });

  it("matches a word split across tokens", async () => {
    const out = await collect(["Do you use Xe", "ro for ", "billing?"], [xero]);
    expect(out.join("")).toBe("Do you use ZEER-oh for billing?");
  });

  it("never emits half a word", async () => {
    const out = await collect(["Do you use Xe", "ro"], [xero]);
    expect(out[0]).toBe("Do you use ");
    expect(out.join("")).toBe("Do you use ZEER-oh");
  });

  it("holds back a partial multi-word entry until it resolves", async () => {
    const entries: PronunciationEntry[] = [{ word: "New York", alphabet: "respell", phoneme: "noo YORK" }];
    expect((await collect(["Fly to New ", "York today"], entries)).join("")).toBe("Fly to noo YORK today");
    expect((await collect(["Fly to New ", "Jersey today"], entries)).join("")).toBe("Fly to New Jersey today");
  });

  it("flushes a trailing held word at the end of the stream", async () => {
    const entries: PronunciationEntry[] = [{ word: "New York", alphabet: "respell", phoneme: "noo YORK" }];
    expect((await collect(["Fly to New "], entries)).join("")).toBe("Fly to New ");
  });

  it("matches the non-streamed result for any chunking", async () => {
    const text = "Hi, this is Xero. We love Xero's reports, and New York too.";
    const entries: PronunciationEntry[] = [
      xero,
      { word: "New York", alphabet: "cmu", phoneme: "N UW1 Y AO1 R K" },
    ];
    const expected = applyPronunciationDictionary(text, entries, fish);
    for (const size of [1, 2, 3, 5, 8]) {
      const chunks = text.match(new RegExp(`.{1,${size}}`, "gs")) ?? [];
      expect((await collect(chunks, entries)).join("")).toBe(expected);
    }
  });
});
