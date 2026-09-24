/**
 * WhatsApp opt-out detection.
 *
 * Written after two people in Avenue Elite asked to be left alone in plain sentences and were
 * messaged again days later: the detector only matched single keywords like "stop", so
 * "Do not send any messages in the future." and "Delete my data immediately" both scored false and
 * neither contact was ever flagged do_not_contact.
 *
 * The risk cuts both ways, so the negative cases matter as much as the positive ones: flagging an
 * ordinary "not interested" would silently shrink every future audience.
 */
import { describe, expect, it } from "vitest";
import { isWhatsappOptOutMessage } from "@/lib/whatsapp/wa-opt-out.shared";

describe("isWhatsappOptOutMessage", () => {
  it("still catches the single-keyword replies", () => {
    for (const m of ["STOP", "stop", "unsubscribe", "remove me", "opt out", "cancel", "quit"]) {
      expect(isWhatsappOptOutMessage(m)).toBe(true);
    }
  });

  it("catches the real messages that were missed", () => {
    // Verbatim from the Avenue Elite inbox.
    expect(isWhatsappOptOutMessage("Do not send any messages in the future.")).toBe(true);
    expect(isWhatsappOptOutMessage("Delete and block my number quickly now")).toBe(true);
    expect(
      isWhatsappOptOutMessage(
        "Delete my data immediately .. your communication appears to breach UAE Telemarketing " +
          "Regulations (Cabinet Resolution No. 56 of 2024) Including use of an unregistered number. " +
          "Delete all my information held and don't contact again or further action with TDRA will be taken!!",
      ),
    ).toBe(true);
  });

  it("catches other plain-language ways of saying stop", () => {
    for (const m of [
      "Please stop sending me these messages",
      "don't contact me again",
      "Please remove me from your list",
      "take me off your database",
      "block my number please",
      "I withdraw my consent to be contacted",
      "no more messages thanks",
      "never call me again",
    ]) {
      expect(isWhatsappOptOutMessage(m)).toBe(true);
    }
  });

  it("does not treat a sales rejection as an opt-out", () => {
    for (const m of [
      "not interested",
      "not interested right now, maybe next year",
      "I already sold it",
      "no thanks",
      "I'm not looking to sell at the moment",
      "Can you stop by the office tomorrow?",
      "I need to delete my old listing photos",
      "",
    ]) {
      expect(isWhatsappOptOutMessage(m)).toBe(false);
    }
  });
});
