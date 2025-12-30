// API notes:
// - Review times (`answerTime`, `reactionTime`, `charTime`) are in milliseconds.
// - Review spacing is expressed in days (`daysSinceLastReview`) or milliseconds (`msSinceLastReview` in the default wrapper).
// - Pass `0`/`undefined` for strength/difficulty to coerce to defaults.
// - `AnswerScore` ranges from `0` (wrong) to `1.5` (perfect recall).
// - Clamp only where needed to keep the math stable without washing out signal.

/**
 * Memory model overview
 *
 * A memory model is limited mainly in two ways:
 * - Limited observability of the user's actual memory state.
 * - Limited observability of interactions with the item outside the system.
 *
 * The model addresses this by capturing as many review-time signals as possible and using
 * indirect measurements to estimate unobservable properties.
 *
 * State tracked per item:
 * - `strength` (days): how long the item is expected to be retained.
 * - `difficulty` (unitless): proxy for item-intrinsic hardness.
 * - `currentStreak`: consecutive fully-correct recalls.
 *
 * Primary outputs:
 * - Forget probability (aka "forgettability") for prioritization.
 * - Updated `strength` and `difficulty` after a review.
 *
 * Signals from a review:
 * - `answerScore` (correctness/recall quality; see `AnswerScore`)
 * - `answerTime` (ms), adjusted for item length
 *
 * Derived signals:
 * - `speedScore`: rewards unusually fast correct answers after normalizing for length.
 * - `streakBonus`: rewards sustained performance (only for correct answers and with >= 1 day spacing).
 * - `answerQuality`: combined signal used to update `strength` and `difficulty`.
 */

// util constants
export const MS_IN_DAY = 24 * 60 * 60 * 1000;

// constants for memory model
export const BASE_COGNITIVE_REACTION_TIME = 250; // base time for action: click, read, understand
export const CHAR_REACTION_TIME = 20; // additional time per character in the item
export const EXPECTED_SPEED_MULTIPLIER = 15; // we are not sure about the expected speed since it involves many variables that we cannot measure, so we set it high to reward fast answers more and still reward less and less for slower answers
export const ANSWER_SPEED_WEIGHT = 0.3;

export const DIFFICULTY_CORRECTION_WEIGHT = 0.1;

export const MIN_STRENGTH = 1; // in days
export const DEFAULT_STRENGTH = MIN_STRENGTH;

export const MIN_DIFFICULTY = 1;
export const MAX_DIFFICULTY = 10;
export const DEFAULT_DIFFICULTY = 2;

export const MIN_ANSWER_QUALITY = 0;
export const MAX_ANSWER_QUALITY = 2;

export const MIN_SPEED_SCORE = 0;
export const MAX_SPEED_SCORE = 1;

export const MIN_STREAK_THRESHOLD = 1; // minimum streak to start getting bonus
export const STREAK_BONUS_WEIGHT = 0.2;
export const MIN_STREAK_BONUS = 0;
export const MAX_STREAK_BONUS = 1;

/**
 * SS = (kET/AT) - 1
 * ET = r + (c x L)
 * where
 * SS = Speed Score
 * ET = Expected Time
 * AT = Actual Time (time taken by user to answer)
 * k = EXPECTED_SPEED_MULTIPLIER (scaling factor)
 * r = Base Cognitive Reaction Time
 * L = Length of the item (e.g., number of characters)
 * c = Character Time
 */
export function getSpeedScore(params: {
  itemLength: number;
  answerTime: number;
  reactionTime: number;
  charTime: number;
  expectedSpeedMultiplier: number;
}): number {
  const {
    itemLength,
    answerTime,
    reactionTime,
    charTime,
    expectedSpeedMultiplier,
  } = params;

  if (answerTime < reactionTime) return 0; // This prevents extreme high speeds (probably accidental)

  const expectedTime = reactionTime + charTime * itemLength;

  const speedRatio = (expectedSpeedMultiplier * expectedTime) / answerTime;
  const rawScore = speedRatio - 1;

  const positiveScore = clamp({ x: rawScore, min: MIN_SPEED_SCORE }); // only positive scores

  return boundedRescaleTanh(positiveScore, 0.5);
}

/**
 * SB = tanh(k * (streak - threshold))
 * k = sensitivity (default 0.4)
 */
export function getStreakBonus(params: {
  currentStreak: number;
  streakBonusThreshold: number;
}): number {
  const { currentStreak, streakBonusThreshold } = params;

  if (currentStreak < streakBonusThreshold) return 0;
  const adjustedStreak = currentStreak - streakBonusThreshold; // positive

  return boundedRescaleTanh(adjustedStreak, 0.4);
}

/**
 * AQ = AS + (sw * SS) + (bw * SB)
 * where
 * AQ = Answer Quality
 * AS = Answer Score
 * SS = Speed Score
 * SB = Streak Bonus
 */
export function getAnswerQuality(params: {
  answerScore: number;
  speedScore: number;
  speedWeight: number;
  bonus: number;
  bonusWeight: number;
}): number {
  const { answerScore, speedScore, speedWeight, bonus, bonusWeight } = params;

  const answerQuality =
    answerScore + speedWeight * speedScore + bonusWeight * bonus;

  return clamp({
    x: answerQuality,
    min: MIN_ANSWER_QUALITY,
    max: MAX_ANSWER_QUALITY,
  });
}

/**
 * Updates strength (in days).
 *
 * - If `answerQuality === 0`, apply a forgetting penalty.
 * - Otherwise, grow strength proportionally to spacing and inversely to difficulty.
 */
export function getStrength(params: {
  answerQuality: number;
  currentStrength: number;
  currentDifficulty: number;
  daysSinceLastReview: number;
}) {
  const {
    answerQuality,
    currentStrength,
    currentDifficulty,
    daysSinceLastReview,
  } = params;

  if (answerQuality === 0)
    return clamp({ x: currentStrength * 0.3, min: MIN_STRENGTH }); // forgetting penalty

  // the original version: Sn = Sc * (1 + AQ * T / (Dc * Sc)), where the latter represents decay
  const newStrength =
    currentStrength + answerQuality * (daysSinceLastReview / currentDifficulty);

  return clamp({ x: newStrength, min: MIN_STRENGTH });
}

/**
 * ND = OD - cw * (AQ - 1)
 * where
 * ND = New Difficulty
 * OD = Old Difficulty
 * cw = Correction Weight
 * AQ = Answer Quality
 */
export function getDifficulty(params: {
  currentDifficulty: number;
  answerQuality: number;
  correctionWeight: number;
}): number {
  const { currentDifficulty, answerQuality, correctionWeight } = params;

  const newDifficulty =
    currentDifficulty - correctionWeight * (answerQuality - 1);

  return clamp({ x: newDifficulty, min: MIN_DIFFICULTY, max: MAX_DIFFICULTY }); // clamp to [MIN_DIFFICULTY, 10]
}

/**
 * Forget probability (formal forgettability) in [0, 1)
 * F = 1 - exp(-(T*D/S))
 * where T = days since last review, D = difficulty, S = strength
 * (saturates fast; good for interpretation, not great for ranking/reward)
 */
export const getForgetProbability = (params: {
  strength: number;
  difficulty: number;
  timeSinceLastReview?: number;
  daysSinceLastReview?: number;
}) => {
  const { strength, difficulty } = params;
  const daysSinceLastReview =
    params.daysSinceLastReview ?? params.timeSinceLastReview ?? 0;

  const decayExponent =
    (daysSinceLastReview * difficulty) / safeDenom(strength);
  const recallProbability = Math.exp(-decayExponent);
  const forgetProbability = 1 - recallProbability;

  return forgetProbability;
};

export enum AnswerScore {
  VERY_KNOW = 1.5,
  KNOW = 1,
  CLUE = 0.5,
  CLUES = 0.2,
  NO = 0,
}

export interface MemoryInternals {
  daysSinceLastReview: number;
  currentForgetProbability: number;
  expectedAnswerTime: number;
  answerTime: number;
  speedScore: number;
  answerScore: number;
  streakBonus: number;
  answerQuality: number;
  currentStrength: number;
  newStrength: number;
  currentDifficulty: number;
  newDifficulty: number;
  currentStreak: number;
  newStreak: number;
}

export const getNewState = (
  params: {
    answerScore: number;
    answerTime: number;
    itemLength: number;
    currentStrength: number;
    daysSinceLastReview: number;
    currentDifficulty: number;
    reactionTime: number;
    charTime: number;
    speedWeight: number;
    correctionWeight: number;
    expectedSpeedMultiplier: number;
    currentStreak: number;
    streakBonusThreshold: number;
    bonusWeight: number;
  },
  reportCB?: (internals: MemoryInternals) => void,
) => {
  const {
    itemLength,
    answerScore,
    answerTime,
    reactionTime,
    charTime,
    speedWeight,
    correctionWeight,
    expectedSpeedMultiplier,
    daysSinceLastReview,
    currentStreak,
    streakBonusThreshold,
    bonusWeight,
  } = params;
  let { currentStrength, currentDifficulty } = params;

  if (itemLength <= 0) throw new Error("Length must be greater than zero.");
  if (currentStrength <= 0) currentStrength = DEFAULT_STRENGTH; // coercing to default strength
  if (currentDifficulty <= 0) currentDifficulty = DEFAULT_DIFFICULTY; // coercing to default difficulty

  const newStreak = answerScore >= 1 ? currentStreak + 1 : 0;

  // Return with the same values if this is an immediate review and not the first review
  if (
    daysSinceLastReview <= 0.11 &&
    (currentStrength != DEFAULT_STRENGTH ||
      currentDifficulty != DEFAULT_DIFFICULTY)
  )
    return returnFunction(
      0,
      0,
      0,
      currentStrength,
      currentDifficulty,
      currentStreak,
    );

  // Speed plays role only if the answer is completely correct
  const speedScore =
    answerScore >= 1
      ? getSpeedScore({
          itemLength,
          answerTime,
          reactionTime,
          charTime,
          expectedSpeedMultiplier,
        })
      : 0;

  const streakBonus =
    answerScore >= 1 && daysSinceLastReview >= 1
      ? getStreakBonus({ currentStreak, streakBonusThreshold })
      : 0;

  const answerQuality = getAnswerQuality({
    answerScore,
    speedScore,
    speedWeight,
    bonus: streakBonus,
    bonusWeight,
  });

  const newDifficulty = getDifficulty({
    currentDifficulty,
    answerQuality,
    correctionWeight,
  });

  const newStrength = getStrength({
    answerQuality,
    currentStrength,
    currentDifficulty,
    daysSinceLastReview,
  });

  function returnFunction(
    speedScore: number,
    streakBonus: number,
    answerQuality: number,
    newStrength: number,
    newDifficulty: number,
    newStreak: number,
  ) {
    // record internals for debugging or analysis
    if (reportCB) {
      reportCB({
        daysSinceLastReview,
        currentForgetProbability: getForgetProbability({
          strength: currentStrength,
          difficulty: currentDifficulty,
          daysSinceLastReview,
        }),
        expectedAnswerTime: reactionTime + charTime * itemLength,
        answerTime,
        speedScore,
        answerScore,
        streakBonus,
        answerQuality,
        currentStrength,
        newStrength,
        currentDifficulty,
        newDifficulty,
        currentStreak,
        newStreak,
      });
    }

    return { newStrength, newDifficulty, newStreak };
  }

  return returnFunction(
    speedScore,
    streakBonus,
    answerQuality,
    newStrength,
    newDifficulty,
    newStreak,
  );
};

export function getNewStateWithDefaults(
  params: {
    answerScore: number;
    answerTime: number;
    itemLength: number;
    strength: number;
    msSinceLastReview: number;
    difficulty: number;
    streak: number;
  },
  reportCB?: (internals: MemoryInternals) => void,
) {
  const {
    answerScore,
    answerTime,
    itemLength,
    strength,
    msSinceLastReview,
    difficulty,
    streak,
  } = params;

  return getNewState(
    {
      answerScore,
      answerTime,
      itemLength,
      currentStrength: strength,
      daysSinceLastReview: msSinceLastReview / MS_IN_DAY,
      currentDifficulty: difficulty,
      reactionTime: BASE_COGNITIVE_REACTION_TIME,
      charTime: CHAR_REACTION_TIME,
      speedWeight: ANSWER_SPEED_WEIGHT,
      correctionWeight: DIFFICULTY_CORRECTION_WEIGHT,
      expectedSpeedMultiplier: EXPECTED_SPEED_MULTIPLIER,
      currentStreak: streak,
      streakBonusThreshold: MIN_STREAK_THRESHOLD,
      bonusWeight: STREAK_BONUS_WEIGHT,
    },
    reportCB,
  );
}

// ! UTILS
// * --------------------------------------------------------------------------------

/**
 * Clamp x to be within [min, max]
 * To clamp to only one side set min or max to undefined
 */
export const clamp = (args: {
  x: number;
  min?: number;
  max?: number;
}): number => {
  let result = args.x;
  if (args.min !== undefined) result = Math.max(args.min, args.x);
  if (args.max !== undefined) result = Math.min(args.max, result);
  return result;
};

/**
 * Prevents division by zero by ensuring denominator is at least eps away from zero
 */
const safeDenom = (d: number, eps = 1e-8): number => {
  return Math.abs(d) < eps ? Math.sign(d || 1) * eps : d;
};

/**
 * Rescales x from (-∞, +∞) to (a, b) using tanh function
 * @param k  sensitivity parameter, controls the steepness - larger k = faster saturation to bounds, smaller k = more gradual transition
 */
const boundedRescaleTanh = (x: number, k = 1, a = -1, b = 1) => {
  const m = (a + b) / 2;
  const r = (b - a) / 2;
  return m + r * Math.tanh(k * x);
};

export function boundedAsymmetricTanh(
  x: number,
  a: number,
  b: number,
  kPos = 1,
  kNeg = 0.3,
) {
  const k = x >= 0 ? kPos : kNeg;
  return boundedRescaleTanh(x, k, a, b);
}

// ! Unused models below - keep for reference
// * --------------------------------------------------------------------------------
/**
 * Log-overdue signal (unsaturated, slow growth)
 * signal = log1p(x)
 * (good for ranking/reward; monotonic in x)
 */
export const getLogOverdueSignal = (params: {
  strength: number;
  difficulty: number;
  daysSinceLastReview: number;
}) => {
  const { strength, difficulty, daysSinceLastReview } = params;
  const decayExponent =
    (daysSinceLastReview * difficulty) / safeDenom(strength);
  return Math.log1p(decayExponent);
};

/**
 * Reverse-exponent curve (NOT a standard memory model)
 * G = exp(-1/x) = exp(-S/(T*D))
 * (flat near 0, slow approach to 1; keep only if you intentionally want this shape)
 */
export const getReverseExponentCurve = (params: {
  strength: number;
  difficulty: number;
  daysSinceLastReview: number;
}) => {
  const { strength, difficulty, daysSinceLastReview } = params;
  const decayExponent =
    (daysSinceLastReview * difficulty) / safeDenom(strength);
  return Math.exp(-1 / safeDenom(decayExponent));
};

export const getForgettabilityTest = (params: {
  strength: number;
  difficulty: number;
  daysSinceLastReview: number;
}) => {
  const { strength, difficulty, daysSinceLastReview } = params;
  return {
    formal: getForgetProbability({ strength, difficulty, daysSinceLastReview }),
    logOverdue: getLogOverdueSignal({
      strength,
      difficulty,
      daysSinceLastReview,
    }),
    reverseExponent: getReverseExponentCurve({
      strength,
      difficulty,
      daysSinceLastReview,
    }),
    decayExponent: (daysSinceLastReview * difficulty) / safeDenom(strength),
  };
};
