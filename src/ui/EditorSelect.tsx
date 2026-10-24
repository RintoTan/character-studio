import { Select, type SelectProps } from "@mantine/core";
import { useEffect, useRef, useState } from "react";

/**
 * A `Select` that tells assistive tech whether its list is open.
 *
 * Mantine 7.17 renders the target as a read-only input with `aria-haspopup="listbox"`,
 * `aria-controls` and `aria-activedescendant`, but only writes `aria-expanded` when the
 * internal `withExpandedAttribute` flag is on — and `Select` never turns it on, nor
 * exposes it. The visible result of that gap is a control a screen reader cannot say is
 * open or closed; the underlying `<select>` this replaced announced it natively.
 *
 * Tracking the open state here is the smallest way to close the gap without forking the
 * component. The attribute is written to the same input the rest of the combobox
 * attributes live on: passing it as a prop does not survive, because the target props
 * Mantine clones onto the input carry `aria-expanded: undefined` and overwrite it.
 */
export function EditorSelect({ onDropdownOpen, onDropdownClose, ...props }: SelectProps) {
  const [opened, setOpened] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.setAttribute("aria-expanded", opened ? "true" : "false");
  }, [opened]);

  return (
    <Select
      {...props}
      ref={inputRef}
      onDropdownClose={() => {
        setOpened(false);
        onDropdownClose?.();
      }}
      onDropdownOpen={() => {
        setOpened(true);
        onDropdownOpen?.();
      }}
    />
  );
}
