import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

describe("frontend test env", () => {
  it("renders a React element into jsdom", () => {
    render(<button type="button">hello</button>);
    expect(screen.getByRole("button", { name: "hello" })).toBeInTheDocument();
  });
});
