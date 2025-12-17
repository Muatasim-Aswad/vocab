// Time in milliseconds
const BASE_COGNITIVE_REACTION_TIME = 250; // base time for action: click, read, understand
const CHAR_REACTION_TIME = 20; // additional time per character in the item

const ANSWER_SPEED_RATIO_WEIGHT = 0.3;

const DIFFICULTY_CORRECTION_WEIGHT = 0.1;

enum AnswerScore {
  Known = 1,
  Unknown = 0,
  FirstClueUsed = 0.5,
  SecondClueUsed = 0.2,
}

export function getSpeedScore(args: {
  itemLength: number;
  answerTime: number;
}): number {
  if (args.answerTime == 0) return 0;
  // Word frequency effect can be added
  const expectedTime =
    BASE_COGNITIVE_REACTION_TIME + CHAR_REACTION_TIME * args.itemLength;

  const speedRatio = expectedTime / args.answerTime;
  const speedScore = ANSWER_SPEED_RATIO_WEIGHT * (speedRatio - 1);

  return speedScore;
}

/**
 * Calculate new strength and difficulty after a review
 */
type GetNewStrengthAndDifficulty = (
  answerScore: AnswerScore,
  answerTime: number,
  itemLength: number,
  strength: number,
  timeSinceLastReview: number,
  difficulty: number,
) => {
  newStrength: number;
  newDifficulty: number;
};

export const getNewStrengthAndDifficulty: GetNewStrengthAndDifficulty = (
  answerScore,
  answerTime,
  itemLength,
  strength,
  timeSinceLastReview,
  difficulty,
) => {
  const speedScore = getSpeedScore({
    itemLength,
    answerTime,
  });
  const answerQuality = answerScore + speedScore;

  const urgency = timeSinceLastReview / strength;

  const stabilityModifier = 1 + difficulty * answerQuality * urgency;

  const newStrength = strength * stabilityModifier;

  // clamp difficulty
  const newDifficulty =
    difficulty - DIFFICULTY_CORRECTION_WEIGHT * (answerQuality - 1);

  return { newStrength, newDifficulty };
};

/**
 * Calculate priority of an item for review
 */
type GetPriority = (strength: number, timeSinceLastReview: number) => number;

export const getPriority: GetPriority = (strength, timeSinceLastReview) => {
  const recallProbability = Math.exp(-timeSinceLastReview / strength);
  return 1 - recallProbability;
};

/**
 * Clamp value
 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
