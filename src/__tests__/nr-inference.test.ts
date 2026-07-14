import { describe, it, expect } from "vitest";
import { inferNrCode, normalizeNr, mapDocStatus } from "@/lib/sst/nr-inference";

describe("normalizeNr", () => {
  it("pads to two digits", () => {
    expect(normalizeNr("6")).toBe("NR-06");
    expect(normalizeNr("35")).toBe("NR-35");
    expect(normalizeNr("06")).toBe("NR-06");
  });
  it("returns empty for invalid", () => {
    expect(normalizeNr("abc")).toBe("");
    expect(normalizeNr("100")).toBe("NR-10"); // captura os dois primeiros dígitos
  });
});

describe("inferNrCode", () => {
  it("detects NR from category (nr_35)", () => {
    const r = inferNrCode({ category: "nr_35" });
    expect(r).toEqual({ status: "single", nrCode: "NR-35", source: "category" });
  });
  it("detects NR from file_name", () => {
    const r = inferNrCode({ file_name: "Treinamento NR6 - Fulano.pdf" });
    expect(r).toEqual({ status: "single", nrCode: "NR-06", source: "file_name" });
  });
  it("returns none when no hint", () => {
    expect(inferNrCode({ file_name: "documento.pdf" })).toEqual({ status: "none" });
    expect(inferNrCode({ document_type: "operacional_vinculo", category: "outros" })).toEqual({ status: "none" });
  });
  it("returns multiple when two distinct NRs are present", () => {
    const r = inferNrCode({ category: "nr_10", file_name: "NR-35_e_NR-10.pdf" });
    expect(r.status).toBe("multiple");
    if (r.status === "multiple") {
      expect(r.nrCodes).toEqual(["NR-10", "NR-35"]);
    }
  });
  it("multiple NRs in the same field also fall into multiple", () => {
    const r = inferNrCode({ file_name: "NR35 e NR06.pdf" });
    expect(r.status).toBe("multiple");
  });
  it("does not use notes when a categoria já resolveu (mas duplicidade coerente ainda é single)", () => {
    const r = inferNrCode({ category: "nr_35", notes: "Curso NR35 renovação" });
    expect(r).toEqual({ status: "single", nrCode: "NR-35", source: "category" });
  });
});

describe("mapDocStatus", () => {
  it("maps approved to ok", () => expect(mapDocStatus("approved")).toBe("ok"));
  it("maps rejected to rejected", () => expect(mapDocStatus("rejected")).toBe("rejected"));
  it("maps other to pending", () => {
    expect(mapDocStatus("uploaded")).toBe("pending");
    expect(mapDocStatus(null)).toBe("pending");
  });
});