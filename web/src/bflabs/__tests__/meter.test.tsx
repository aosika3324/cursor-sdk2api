import { describe, expect, it } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Meter } from "../Meter";

function bar() {
  return screen.getByRole("progressbar");
}

describe("bflabs Meter", () => {
  it("renders danger tone near the limit and always prints the value + percent", async () => {
    const { container } = render(<Meter label="Cursor" used={95} limit={100} />);
    const el = bar();
    expect(el).toHaveAttribute("data-tone", "danger");
    expect(el).toHaveAttribute("aria-valuenow", "95");
    expect(el).toHaveAttribute("aria-valuemin", "0");
    expect(el).toHaveAttribute("aria-valuemax", "100");
    expect(el).toHaveAttribute("aria-label", "Cursor");
    // tone conveys pressure but the value is ALWAYS printed (raw value is immediate)
    expect(container.textContent).toMatch(/95\s*\/\s*100/);
    // the percent animates via CountUp toward the final value
    await waitFor(() => expect(container.textContent).toMatch(/95\s*%/), { timeout: 2000 });
  });

  it("uses default tone well below the limit", () => {
    render(<Meter label="Low" used={10} limit={100} />);
    expect(bar()).toHaveAttribute("data-tone", "default");
    expect(bar()).toHaveAttribute("aria-valuenow", "10");
  });

  it("uses warn tone in the 70-90% band", () => {
    render(<Meter label="Mid" used={80} limit={100} />);
    expect(bar()).toHaveAttribute("data-tone", "warn");
  });

  it("guards limit=0 as 0% without crashing", () => {
    const { container } = render(<Meter label="Zero" used={5} limit={0} />);
    const el = bar();
    expect(el).toHaveAttribute("data-tone", "default");
    expect(el).toHaveAttribute("aria-valuenow", "0");
    expect(container.textContent).toMatch(/0\s*%/);
  });

  it("lets an explicit tone prop override auto", () => {
    render(<Meter label="Forced" used={95} limit={100} tone="default" />);
    expect(bar()).toHaveAttribute("data-tone", "default");
  });

  it("renders a reset countdown when resetAt is provided", () => {
    // +30s cushion so the floor lands cleanly on 2h30m despite elapsed ms
    const resetAt = Date.now() + (2 * 60 + 30) * 60 * 1000 + 30_000;
    render(<Meter label="Reset" used={10} limit={100} resetAt={resetAt} />);
    expect(screen.getByText(/2h\s*30m/)).toBeInTheDocument();
  });

  it("renders a unit and detail node", () => {
    render(<Meter label="Unit" used={3} limit={10} unit="req" detail="extra info" />);
    expect(screen.getByText(/3\s*\/\s*10\s*req/)).toBeInTheDocument();
    expect(screen.getByText("extra info")).toBeInTheDocument();
  });
});
