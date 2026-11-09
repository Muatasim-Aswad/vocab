import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const SearchIcon = () => (
  <Icon>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-4-4" />
  </Icon>
);

export const AddIcon = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const SuggestIcon = () => (
  <Icon>
    <path d="M11 3 12.9 8.1 18 10l-5.1 1.9L11 17l-1.9-5.1L4 10l5.1-1.9Z" />
    <path d="M19 15v6M16 18h6" />
  </Icon>
);

export const RemoveIcon = () => (
  <Icon>
    <path d="M18 6 6 18M6 6l12 12" />
  </Icon>
);

export const InfoIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
);

export const EditIcon = () => (
  <Icon>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </Icon>
);

export const MoreIcon = () => (
  <Icon>
    <circle cx="12" cy="5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </Icon>
);

export const BackIcon = () => (
  <Icon>
    <path d="m12 19-7-7 7-7M19 12H5" />
  </Icon>
);

export const PreviousIcon = () => (
  <Icon>
    <path d="m15 18-6-6 6-6" />
  </Icon>
);

export const NextIcon = () => (
  <Icon>
    <path d="m9 18 6-6-6-6" />
  </Icon>
);

// Clear and Keep draft follow Lucide (ISC): eraser, bookmark.
export const ClearIcon = () => (
  <Icon>
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21M22 21H7M5 11l9 9" />
  </Icon>
);

export const KeepIcon = () => (
  <Icon>
    <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2Z" />
  </Icon>
);

export const MoreHorizontalIcon = () => (
  <Icon>
    <circle cx="5" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="19" cy="12" r="1" fill="currentColor" />
  </Icon>
);

// Relation icons follow Lucide (ISC): equal-approximately, arrow-left-right, git-branch, shuffle, arrow-right.
export const SynonymIcon = () => (
  <Icon>
    <path d="M5 15a6.5 6.5 0 0 1 7 0 6.5 6.5 0 0 0 7 0M5 9a6.5 6.5 0 0 1 7 0 6.5 6.5 0 0 0 7 0" />
  </Icon>
);

export const OppositeIcon = () => (
  <Icon>
    <path d="M8 3 4 7l4 4M4 7h16M16 21l4-4-4-4M20 17H4" />
  </Icon>
);

export const WordFamilyIcon = () => (
  <Icon>
    <path d="M6 3v12M18 9a9 9 0 0 1-9 9" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
  </Icon>
);

export const WordTypeIcon = () => (
  <Icon>
    <path d="m18 14 4 4-4 4M18 2l4 4-4 4M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M2 6h1.9c1.5 0 2.9.9 3.6 2.2M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8" />
  </Icon>
);

export const SeeAlsoIcon = () => (
  <Icon>
    <path d="M5 12h14M12 5l7 7-7 7" />
  </Icon>
);

/** The wordmark; decorative, since it only brands the footer. */
export const Logo = () => (
  <span className="ms-auto font-bold text-supporting" aria-hidden="true">
    Vocab
  </span>
);
