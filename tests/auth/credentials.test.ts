import { describe, expect, it } from "vitest";
import { managedAccountAuth, extractSandJwt } from "../../src/auth/credentials.js";

describe("sand JWT in auth context", () => {
  it("extracts the JWT half from a session token", () => {
    expect(extractSandJwt("user_X::jwt.body.sig")).toBe("jwt.body.sig");
    expect(extractSandJwt("user_X%3A%3Ajwt.body.sig")).toBe("jwt.body.sig");
    expect(extractSandJwt("crsr_notasession")).toBeUndefined();
  });

  it("returns undefined for malformed percent-encoding without throwing", () => {
    expect(() => extractSandJwt("user_X%3a%3a%zz.b.c")).not.toThrow();
    expect(extractSandJwt("user_X%3a%3a%zz.b.c")).toBeUndefined();
  });

  it("rejects a non-JWT (non 3-segment) second half", () => {
    expect(extractSandJwt("user_X::not.ajwt")).toBeUndefined();
  });

  it("managedAccountAuth carries sandJwt when a session token is given", () => {
    const auth = managedAccountAuth("crsr_key", undefined, "user_X::jwt.body.sig");
    expect(auth.cursorApiKey).toBe("crsr_key");
    expect(auth.sandJwt).toBe("jwt.body.sig");
  });

  it("managedAccountAuth omits sandJwt when no session token", () => {
    const auth = managedAccountAuth("crsr_key");
    expect(auth.sandJwt).toBeUndefined();
  });
});
