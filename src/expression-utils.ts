export function extractExpressionFromCode(code: string): string {
  return code
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n")
      .trim();
}