import { describe, it, expect } from "vitest";
import { neutralizeCsvCell } from "@/lib/qualifications-export";

describe("neutralizeCsvCell", () => {
  it("não altera valores comuns", () => {
    expect(neutralizeCsvCell("Maria Silva")).toBe("Maria Silva");
    expect(neutralizeCsvCell("")).toBe("");
    expect(neutralizeCsvCell("123,45")).toBe("123,45");
  });

  it("neutraliza prefixos executáveis diretos", () => {
    expect(neutralizeCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(neutralizeCsvCell("+1+1")).toBe("'+1+1");
    expect(neutralizeCsvCell("-2+3")).toBe("'-2+3");
    expect(neutralizeCsvCell("@cmd")).toBe("'@cmd");
  });

  it("neutraliza mesmo com espaços antes do prefixo", () => {
    expect(neutralizeCsvCell(" =SUM(A1:A2)")).toBe("' =SUM(A1:A2)");
    expect(neutralizeCsvCell("   +1")).toBe("'   +1");
    expect(neutralizeCsvCell("  -2")).toBe("'  -2");
    expect(neutralizeCsvCell("  @x")).toBe("'  @x");
  });

  it("neutraliza com tab antes do prefixo", () => {
    expect(neutralizeCsvCell("\t=SUM(A1)")).toBe("'\t=SUM(A1)");
    expect(neutralizeCsvCell("\t\t+1")).toBe("'\t\t+1");
  });

  it("neutraliza com CR/LF antes do prefixo", () => {
    expect(neutralizeCsvCell("\r=SUM(A1)")).toBe("'\r=SUM(A1)");
    expect(neutralizeCsvCell("\n-2")).toBe("'\n-2");
    expect(neutralizeCsvCell("\r\n@x")).toBe("'\r\n@x");
  });

  it("neutraliza combinações mistas de whitespace", () => {
    expect(neutralizeCsvCell(" \t\r\n =evil")).toBe("' \t\r\n =evil");
  });

  it("não neutraliza quando há caractere textual antes do prefixo", () => {
    expect(neutralizeCsvCell("a=b")).toBe("a=b");
    expect(neutralizeCsvCell("x -1")).toBe("x -1");
    expect(neutralizeCsvCell("email: a@b")).toBe("email: a@b");
  });

  it("trata null/undefined como string vazia", () => {
    expect(neutralizeCsvCell(null as unknown as string)).toBe("");
    expect(neutralizeCsvCell(undefined as unknown as string)).toBe("");
  });
});