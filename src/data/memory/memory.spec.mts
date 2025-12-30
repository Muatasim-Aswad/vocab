import {
  AnswerScore,
  getNewStateWithDefaults,
  getForgetProbability,
  type MemoryInternals,
  MS_IN_DAY,
} from "./memory.mjs";

// Interval generators for different run patterns
type Config = number[] | number | ((index: number) => number); // function for custom transformations. e.g. (i) => i * 2

function generateRuns(params: {
  answerScores: AnswerScore | AnswerScore[] | ((index: number) => AnswerScore);
  answerTimes: Config;
  daysSinceLastReview: Config;
  times?: number; // required only if all three are not arrays, otherwise inferred from any array length
}): Runs {
  const { answerScores, answerTimes, daysSinceLastReview, times } = params;

  // Determine the length
  let length = times;
  if (Array.isArray(answerScores)) length = answerScores.length;
  else if (Array.isArray(answerTimes)) length = answerTimes.length;
  else if (Array.isArray(daysSinceLastReview))
    length = daysSinceLastReview.length;

  if (!length) {
    throw new Error("Either provide times or at least one array parameter");
  }

  // Helper to convert Config to array
  const toArray = (config: Config, len: number): number[] => {
    if (Array.isArray(config)) return config;
    if (typeof config === "function")
      return Array.from({ length: len }, (_, i) => config(i));
    return Array.from({ length: len }, () => config);
  };

  const scoresArray = toArray(answerScores, length);
  const timesArray = toArray(answerTimes, length);
  const lastReviewArray = toArray(daysSinceLastReview, length);

  return Array.from({ length }, (_, i) => ({
    aScore: scoresArray[i],
    aTime: timesArray[i],
    lastReview: lastReviewArray[i],
  }));
}

type Runs = {
  aTime: number; // answer time in seconds
  aScore: AnswerScore; // answer score
  lastReview: number; // time since last review in days
}[];

const run = (params: {
  info?: string;
  prevStrength?: number;
  prevDifficulty?: number;
  wordLength?: number;
  runs: Runs;
}) => {
  const prevStrength = params.prevStrength ?? 0;
  const prevDifficulty = params.prevDifficulty ?? 0;
  const length = params.wordLength ?? 10;
  const runs = params.runs;

  if (params.info)
    console.log(`\n\n=== ${params.info} === (Word Length: ${length})`);

  let strength = prevStrength;
  let difficulty = prevDifficulty;
  let streak = 0;

  const results: Array<Record<string, number>> = [];
  let currentDay = 0;
  for (let i = 0; i < runs.length; i++) {
    currentDay += runs[i].lastReview;
    const daysSinceLastReview = runs[i].lastReview;
    const timeSinceLastReview = daysSinceLastReview * MS_IN_DAY;

    // Get values for this iteration - either from array or use single value
    const currentAnswerTime = runs[i].aTime;
    const currentAnswerScore = runs[i].aScore;

    // function that takes internals merge them into the result and push to results
    function transformAndPush(internals: MemoryInternals) {
      results.push({
        day: Number(currentDay.toFixed(2)),
        anSC: currentAnswerScore,
        anT: currentAnswerTime,
        exT: internals.expectedAnswerTime,
        speedScore: internals.speedScore,
        answerQuality: internals.answerQuality,
        newStrength: internals.newStrength,
        newDifficulty: internals.newDifficulty,
        streak: internals.newStreak,
        dLastReview: internals.daysSinceLastReview,
        currentForgetProbability: internals.currentForgetProbability,
      });
    }

    const result = getNewStateWithDefaults(
      {
        answerScore: currentAnswerScore,
        answerTime: currentAnswerTime,
        itemLength: length,
        strength,
        msSinceLastReview: timeSinceLastReview,
        difficulty,
        streak,
      },
      transformAndPush,
    );
    strength = result.newStrength;
    difficulty = result.newDifficulty;
    streak = result.newStreak;
  }

  console.table(results);

  // Get forgettability after 1, 7, 14, 30, 90, 180, 360 days
  console.log("Forgettability over time since last review:");
  const forgettabilityIntervals = [1, 7, 14, 30, 90, 180, 360];
  forgettabilityIntervals.forEach((days) => {
    const strength = results[results.length - 1].newStrength;
    const difficulty = results[results.length - 1].newDifficulty;

    const result = getForgetProbability({
      strength,
      difficulty,
      daysSinceLastReview: days,
    });
    console.log(`  After ${days} days: ${result}.`);
  });

  return { strength, difficulty };
};

const repetitive = () => {
  // Days 0-7: Progressive improvement from worst to best
  run({
    info: "Progressive improvement from worst to best",
    runs: generateRuns({
      answerScores: [0, 0.2, 0.5, 1, 1, 1.5],
      answerTimes: [4000, 4000, 4000, 8000, 4000, 2000, 1000, 500],
      daysSinceLastReview: 1,
    }),
  });

  // Scenario 2: Starting with better performance and going down
  run({
    info: "Declining performance from best to worst",
    runs: generateRuns({
      answerScores: [1.5, 1, 1, 0.5, 0.2, 0],
      answerTimes: [500, 1000, 1000, 4000, 6000, 8000],
      daysSinceLastReview: 1,
    }),
  });
};

const scenario = () => {
  run({
    info: "Realistic Scenario",
    runs: generateRuns({
      answerScores: [0.2, 0.5, 0.2, 0.2, 1.5, 0, 1.5, 1, 1.5],
      daysSinceLastReview: [0, 0.5, 2, 4, 7, 40, 40.5, 70, 30],
      answerTimes: [9000, 7000, 5000, 3000, 2000, 8000, 4000, 8000, 1000],
    }),
  });
};

// log a separator

console.log("#".repeat(100));

repetitive();

scenario();

//Run 5 times with 0.1 day intervals
run({
  info: "Rapid reviews to solidify memory",
  runs: generateRuns({
    answerScores: 1,
    answerTimes: [2000, 1500, 1000, 800, 500],
    daysSinceLastReview: 0.1,
  }),
});
