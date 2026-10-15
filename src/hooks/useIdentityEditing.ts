import { useState, type Dispatch, type SetStateAction } from "react";
import type { CharacterDraft } from "../types/character";
import { calculateAgeFromDate } from "../utils/age";

// The local input state the identity block needs, and the seven ways it writes
// through to the form.
//
// Three fields are edited here and each has its own reason for keeping local state
// beside the form value:
//
//   personalityTags  a free-text box for a tag that is not in the offered list;
//   gender           the offered list plus a "自定义" escape, so the text the author
//                    typed has to be remembered while they are still on 自定义;
//   age / birthDate  two ways to say the same thing, so the form stores whichever
//                    the author chose and the editor remembers which mode they are in.
//
// The hook returns everything under the names the form already used, so the JSX and
// the effects that reset these on a character change did not have to be rewritten.

type Options = {
  setFormData: Dispatch<SetStateAction<CharacterDraft>>;
  /**
   * The form's own generic single-field writer, handed in rather than copied. The
   * hook still needs `setFormData` for the cases that read the previous value -- a
   * tag toggle and the two age modes all write more than one field at a time.
   */
  setField: (field: keyof CharacterDraft, value: string | string[]) => void;
};

export function useIdentityEditing({ setFormData, setField }: Options) {
  const [customTag, setCustomTag] = useState("");
  const [customGender, setCustomGender] = useState("");
  const [genderMode, setGenderMode] = useState("");
  const [ageMode, setAgeMode] = useState<"manual" | "birthDate">("manual");

  function togglePersonalityTag(tag: string) {
    setFormData((current) => {
      const currentTags = current.personalityTags || [];

      return {
        ...current,
        personalityTags: currentTags.includes(tag)
          ? currentTags.filter((item) => item !== tag)
          : [...currentTags, tag],
      };
    });
  }

  // Choosing from the list writes the choice through, but switching to 自定义 must
  // not blank out what is already there -- the author is about to edit it.
  function handleGenderModeChange(value: string) {
    setGenderMode(value);
    setField("gender", value === "自定义" ? customGender : value);
  }

  function handleCustomGenderChange(value: string) {
    setCustomGender(value);
    setField("gender", value);
  }

  // The two age modes are mutually exclusive: each one clears the other's storage so
  // a character can never carry both an age and a birthday that disagree.
  function setManualAge(value: string) {
    setAgeMode("manual");
    setFormData((current) => ({
      ...current,
      age: value.replace(/[^\d]/g, ""),
      birthDate: "",
      birthYear: "",
    }));
  }

  function setBirthDate(value: string) {
    setAgeMode("birthDate");
    setFormData((current) => ({
      ...current,
      age: calculateAgeFromDate(value),
      birthDate: value,
      birthYear: "",
    }));
  }

  function addCustomTag() {
    const nextTag = customTag.trim();

    if (!nextTag) {
      return;
    }

    setFormData((current) => {
      const currentTags = current.personalityTags || [];

      // Adding a tag the author already has leaves the list alone rather than
      // duplicating it -- and still clears the box below, so the input reads as
      // "taken" either way.
      if (currentTags.includes(nextTag)) {
        return current;
      }

      return { ...current, personalityTags: [...currentTags, nextTag] };
    });
    setCustomTag("");
  }

  function removeTag(tag: string) {
    setFormData((current) => ({
      ...current,
      personalityTags: (current.personalityTags || []).filter((item) => item !== tag),
    }));
  }

  return {
    customTag,
    setCustomTag,
    customGender,
    setCustomGender,
    genderMode,
    setGenderMode,
    ageMode,
    setAgeMode,
    togglePersonalityTag,
    handleGenderModeChange,
    handleCustomGenderChange,
    setManualAge,
    setBirthDate,
    addCustomTag,
    removeTag,
  };
}
