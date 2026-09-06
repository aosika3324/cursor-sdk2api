import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Input } from "../Input";
import { Field } from "../Field";
import { Checkbox } from "../Checkbox";
import { Modal } from "../Modal";

describe("bflabs form primitives", () => {
  it("Input forwards value and onChange and carries bf-input", () => {
    const onChange = vi.fn();
    render(<Input value="hi" onChange={onChange} placeholder="name" />);
    const el = screen.getByPlaceholderText("name") as HTMLInputElement;
    expect(el.value).toBe("hi");
    expect(el.className).toContain("bf-input");
    fireEvent.change(el, { target: { value: "yo" } });
    expect(onChange).toHaveBeenCalled();
  });

  it("Field shows error and marks the control invalid", () => {
    render(<Field label="Name" error="required"><Input aria-label="n" /></Field>);
    expect(screen.getByText("required")).toBeInTheDocument();
    expect(screen.getByLabelText("n")).toHaveAttribute("aria-invalid", "true");
  });

  it("Checkbox toggles via onChange", () => {
    const onChange = vi.fn();
    render(<Checkbox checked={false} onChange={onChange} aria-label="c" />);
    fireEvent.click(screen.getByLabelText("c"));
    expect(onChange).toHaveBeenCalled();
  });

  it("Modal renders only when open, closes on Escape, and shows title", () => {
    const onClose = vi.fn();
    const { rerender } = render(<Modal open={false} onClose={onClose} title="T">body</Modal>);
    expect(screen.queryByText("body")).toBeNull();
    rerender(<Modal open onClose={onClose} title="T">body</Modal>);
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
