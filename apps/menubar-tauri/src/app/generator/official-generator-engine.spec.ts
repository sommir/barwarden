import { describe, expect, it, vi } from "vitest";

import { EFFLongWordList } from "../../../../../vendor/bitwarden-clients/libs/common/src/platform/misc/wordlist";
import { OfficialGeneratorEngine } from "./official-generator-engine";

describe("OfficialGeneratorEngine", () => {
  it("maps password options to the official SDK request", async () => {
    const generatePassword = vi.fn(async () => "OfficialPassword1");
    const engine = new OfficialGeneratorEngine({
      generatePassword,
      generatePassphrase: vi.fn(),
      randomNumber: vi.fn(),
    });

    await expect(
      engine.generatePassword({
        lowercase: true,
        uppercase: true,
        number: true,
        special: false,
        length: 14,
        ambiguous: true,
        minLowercase: 1,
        minUppercase: 1,
        minNumber: 1,
      }),
    ).resolves.toBe("OfficialPassword1");

    expect(generatePassword).toHaveBeenCalledWith({
      lowercase: true,
      uppercase: true,
      numbers: true,
      special: false,
      length: 14,
      avoidAmbiguous: false,
      minLowercase: 1,
      minUppercase: 1,
      minNumber: 1,
      minSpecial: undefined,
    });
  });

  it("maps passphrase options to the official SDK request", async () => {
    const generatePassphrase = vi.fn(async () => "official-passphrase");
    const engine = new OfficialGeneratorEngine({
      generatePassword: vi.fn(),
      generatePassphrase,
      randomNumber: vi.fn(),
    });

    await expect(
      engine.generatePassphrase({
        numWords: 6,
        wordSeparator: "-",
        capitalize: false,
        includeNumber: false,
      }),
    ).resolves.toBe("official-passphrase");

    expect(generatePassphrase).toHaveBeenCalledWith({
      numWords: 6,
      wordSeparator: "-",
      capitalize: false,
      includeNumber: false,
    });
  });

  it("uses the EFF word list and four inclusive SDK digits for username generation", async () => {
    const randomNumber = vi
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    const engine = new OfficialGeneratorEngine({
      generatePassword: vi.fn(),
      generatePassphrase: vi.fn(),
      randomNumber,
    });

    await expect(
      engine.generateUsername({ type: "word", wordCapitalize: true, wordIncludeNumber: true }),
    ).resolves.toBe("Abacus0123");

    expect(randomNumber).toHaveBeenNthCalledWith(1, 0, EFFLongWordList.length - 1);
    expect(randomNumber).toHaveBeenNthCalledWith(2, 0, 9);
    expect(randomNumber).toHaveBeenNthCalledWith(3, 0, 9);
    expect(randomNumber).toHaveBeenNthCalledWith(4, 0, 9);
    expect(randomNumber).toHaveBeenNthCalledWith(5, 0, 9);
  });

  it("uses the official eight-character alphabet for plus-addressed email", async () => {
    const randomNumber = vi.fn().mockResolvedValue(0);
    const engine = new OfficialGeneratorEngine({
      generatePassword: vi.fn(),
      generatePassphrase: vi.fn(),
      randomNumber,
    });

    await expect(engine.generateUsername({
      type: "subaddress",
      subaddressEmail: "owner@example.test",
    })).resolves.toBe("owner+aaaaaaaa@example.test");

    expect(randomNumber).toHaveBeenCalledTimes(8);
    expect(randomNumber).toHaveBeenCalledWith(0, 35);
  });

  it("extends an existing subaddress and generates catch-all email", async () => {
    const randomNumber = vi.fn().mockResolvedValue(35);
    const engine = new OfficialGeneratorEngine({
      generatePassword: vi.fn(),
      generatePassphrase: vi.fn(),
      randomNumber,
    });

    await expect(engine.generateUsername({
      type: "subaddress",
      subaddressEmail: "owner+vault@example.test",
    })).resolves.toBe("owner+vault00000000@example.test");
    await expect(engine.generateUsername({
      type: "catchall",
      catchallDomain: "example.test",
    })).resolves.toBe("00000000@example.test");
  });

  it("rejects invalid email settings without echoing their values", async () => {
    const engine = new OfficialGeneratorEngine({
      generatePassword: vi.fn(),
      generatePassphrase: vi.fn(),
      randomNumber: vi.fn(),
    });

    await expect(engine.generateUsername({ type: "subaddress", subaddressEmail: "private-value" }))
      .rejects.toThrow("A valid email address is required");
    await expect(engine.generateUsername({ type: "catchall", catchallDomain: "" }))
      .rejects.toThrow("A valid catch-all domain is required");
    await expect(engine.generateUsername({ type: "subaddress", subaddressEmail: "owner@" }))
      .rejects.toThrow("A valid email address is required");
    await expect(engine.generateUsername({ type: "subaddress", subaddressEmail: "@example.test" }))
      .rejects.toThrow("A valid email address is required");
    await expect(engine.generateUsername({ type: "catchall", catchallDomain: "not a domain" }))
      .rejects.toThrow("A valid catch-all domain is required");
  });
});
