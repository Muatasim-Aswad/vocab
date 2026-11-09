export type StudySessionSelection =
  | {
      type: "top";
      maxWords: number;
    }
  | {
      type: "range";
      startId: number;
      endId?: number;
    };
